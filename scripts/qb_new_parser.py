"""
Parse QB-new.xlsx and assign product question pools per sampling rules.
"""
from __future__ import annotations

import random
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import openpyxl

QUESTIONS_PER_EMPLOYEE = 25

PRODUCT_KEY_ALIASES: dict[str, str] = {
    "HLR HSS": "HLR-HSS",
    "HSS HLR": "HLR-HSS",
    "HLR-HSS": "HLR-HSS",
    "HLR/HSS": "HLR-HSS",
    "HLR HSS CNF DEPLOYMENT": "HLR-HSS",
    "HLR HSS CNF": "HLR-HSS",
    "HSS": "HLR-HSS",
    "HLR": "HLR-HSS",
    "AUSF UDM": "UDM",
    "AUSF/UDM": "UDM",
    "UDM": "UDM",
    "SDL DEPLOYMENT AND UPGRADE": "SDL",
    "SDL": "SDL",
    "CMG": "CMG",
    "CMM": "CMM",
    "EIR": "EIR",
    "NDS": "NDS",
    "NRD": "NRD",
    "NPC": "NPC",
    "AAA": "AAA",
    "CSD": "CSD",
    "NCC": "NCC",
    "CFX": "CFX",
    "MRF": "MRF",
    "NN": "NN",
    "CBIS": "CBIS",
    "NCOM": "NCOM",
    "NCP": "NCP",
    "CBAM": "CBAM",
    "NCD": "NCD",
}

PRODUCT_SAMPLING_RULES: dict[str, dict] = {
    "CMG": {"mode": "random", "count": 25},
    "CMM": {"mode": "random", "count": 25},
    "NRD": {"mode": "random", "count": 25},
    "EIR": {
        "mode": "stratified",
        "total": 25,
        "categories": [
            ("EIR Basic", 10),
            ("Deployment & Troubleshooting", 10),
            ("EIR Planning", 5),
        ],
    },
    "HLR-HSS": {
        "mode": "stratified",
        "total": 25,
        "categories": [
            ("HSS Basics", 10),
            ("HSS Troubleshooting", 10),
            ("HSS Deployment", 5),
        ],
    },
    "NDS": {
        "mode": "stratified",
        "total": 25,
        "categories": [
            ("Basic NDS", 10),
            ("Deployment & Troubleshooting", 10),
            ("Planning & Artifact Preparation", 5),
        ],
    },
    "SDL": {
        "mode": "stratified",
        "total": 25,
        "categories": [
            ("Basic SDL", 10),
            ("Deployment & Troubleshooting", 10),
            ("Planning & Artifact Preparation", 5),
        ],
    },
    "UDM": {
        "mode": "stratified",
        "total": 25,
        "categories": [
            ("UDM Basic", 10),
            ("Deployment & Troubleshooting", 10),
            ("UDM Planning", 5),
        ],
    },
}

CATEGORY_ALIASES: dict[str, str] = {
    "basic udm": "UDM Basic",
    "basic nds": "Basic NDS",
    "basic sdl": "Basic SDL",
}


@dataclass
class McqRecord:
    domain: str
    product: str
    category: str
    question_text: str
    options: list[str] = field(default_factory=list)
    correct_option_index: int = 0

    @property
    def display_text(self) -> str:
        q = clean(self.question_text)
        cat = clean(self.category)
        if cat:
            return f"[{cat}] {q}"
        return q


def clean(val) -> str:
    if val is None:
        return ""
    return str(val).strip()


def normalize_token(s: str) -> str:
    s = clean(s).upper()
    s = re.sub(r"[^A-Z0-9/]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def normalize_question_key(question: str) -> str:
    text = clean(question)
    text = re.sub(r"^\[[^\]]+\]\s*", "", text)
    return re.sub(r"\s+", " ", text).lower()


def normalize_category_key(category: str) -> str:
    if not category:
        return ""
    cat = clean(category).lower()
    cat = re.sub(r"\s+", " ", cat)
    return CATEGORY_ALIASES.get(cat, category.strip())


def resolve_qb_product_key(raw_product: str) -> str | None:
    if not raw_product:
        return None
    token = normalize_token(raw_product)
    if token in PRODUCT_KEY_ALIASES:
        return PRODUCT_KEY_ALIASES[token]
    compact = token.replace(" ", "")
    for alias, key in PRODUCT_KEY_ALIASES.items():
        if compact == alias.replace(" ", "").replace("/", ""):
            return key
    return raw_product.strip()


def dedupe_records(records: list[McqRecord]) -> list[McqRecord]:
    """Drop exact duplicate MCQs (same product + question text). Keeps first occurrence."""
    seen: set[tuple[str, str]] = set()
    unique: list[McqRecord] = []
    for rec in records:
        key = (rec.product, normalize_question_key(rec.question_text))
        if key in seen:
            continue
        seen.add(key)
        unique.append(rec)
    return unique


def unique_for_sampling(records: list[McqRecord]) -> list[McqRecord]:
    """Unique questions for test assignment — avoids duplicate stems in one assessment."""
    return dedupe_records(records)


def _match_correct_index(options: list[str], correct_answer: str) -> int:
    if not options:
        return 0
    correct = clean(correct_answer)
    if not correct:
        return 0
    for idx, opt in enumerate(options):
        if clean(opt) == correct:
            return idx
    letter = correct[:1].upper()
    for idx, opt in enumerate(options):
        if clean(opt).upper().startswith(f"{letter}."):
            return idx
    return 0


def _split_product_sections(rows: list[tuple]) -> list[tuple[str, list[tuple]]]:
    """Split sheet into (product_key, section_rows) blocks."""
    sections: list[tuple[str, list[tuple]]] = []
    current_product: str | None = None
    current_rows: list[tuple] = []

    known_products = set(PRODUCT_SAMPLING_RULES.keys())

    for row in rows:
        cells = [clean(c) for c in row]
        if (
            len(cells) >= 1
            and cells[0] in known_products
            and all(not cells[j] for j in range(1, min(4, len(cells))))
        ):
            if current_product and current_rows:
                sections.append((current_product, current_rows))
            current_product = cells[0]
            current_rows = []
            continue
        if current_product:
            current_rows.append(row)

    if current_product and current_rows:
        sections.append((current_product, current_rows))
    return sections


def _parse_category_section(product_key: str, section_rows: list[tuple]) -> list[McqRecord]:
    """Parse stratified product blocks (Domain/Product/... or compact Category/Question/...)."""
    records: list[McqRecord] = []
    header: list[str] | None = None
    q_idx = cat_idx = correct_idx = domain_idx = product_idx = None
    opt_start = None
    compact_format = False

    for row in section_rows:
        cells = [clean(c) for c in row]
        if not any(cells):
            continue
        if cells[:2] == ["Domain", "Product"]:
            header = cells
            compact_format = False
            domain_idx = header.index("Domain")
            product_idx = header.index("Product")
            q_idx = header.index("Question")
            cat_idx = header.index("Category") if "Category" in header else None
            opt_start = q_idx + 1
            correct_idx = next((i for i, h in enumerate(header) if h.lower().startswith("correct")), None)
            continue
        if cells[0] == "Category" and len(cells) > 1 and cells[1] == "Question":
            header = cells
            compact_format = True
            domain_idx = product_idx = None
            cat_idx = 0
            q_idx = 1
            opt_start = 2
            correct_idx = next((i for i, h in enumerate(header) if h.lower().startswith("correct")), None)
            continue
        if header is None or q_idx is None:
            continue

        domain = cells[domain_idx] if domain_idx is not None and domain_idx < len(cells) else "SDM"
        product = (
            cells[product_idx]
            if product_idx is not None and product_idx < len(cells)
            else product_key
        )
        category = cells[cat_idx] if cat_idx is not None and cat_idx < len(cells) else ""
        question = cells[q_idx] if q_idx < len(cells) else ""
        if not question or question == "Question":
            continue

        if correct_idx is not None and correct_idx < len(cells):
            options = [cells[j] for j in range(opt_start, correct_idx) if j < len(cells) and cells[j]]
            correct_answer = cells[correct_idx]
        else:
            options = [cells[j] for j in range(opt_start, len(cells)) if cells[j]]
            correct_answer = ""

        if len(options) < 2:
            continue

        records.append(
            McqRecord(
                domain=domain if not compact_format else "SDM",
                product=resolve_qb_product_key(product) or product_key,
                category=normalize_category_key(category),
                question_text=question,
                options=options,
                correct_option_index=_match_correct_index(options, correct_answer),
            )
        )
    return records


def _parse_simple_section(product_key: str, section_rows: list[tuple]) -> list[McqRecord]:
    grouped: dict[str, McqRecord] = {}
    header_seen = False

    for row in section_rows:
        cells = [clean(c) for c in row]
        if not any(cells):
            continue
        if cells[:2] == ["Domain", "Product"]:
            header_seen = True
            continue
        if not header_seen:
            continue

        domain, product, question, option_text, correctness = (
            cells[0] if len(cells) > 0 else "",
            cells[1] if len(cells) > 1 else product_key,
            cells[2] if len(cells) > 2 else "",
            cells[3] if len(cells) > 3 else "",
            cells[4] if len(cells) > 4 else "",
        )
        if not question or not option_text or question == "Question":
            continue

        q_key = normalize_question_key(question)
        entry = grouped.setdefault(
            q_key,
            McqRecord(
                domain=domain,
                product=resolve_qb_product_key(product) or product_key,
                category="",
                question_text=question,
            ),
        )
        entry.options.append(option_text)
        if correctness.lower() == "correct":
            entry.correct_option_index = len(entry.options) - 1

    return [item for item in grouped.values() if len(item.options) >= 2]


def parse_qb_new_xlsx(qb_path: Path) -> tuple[dict[str, list[McqRecord]], list[McqRecord]]:
    wb = openpyxl.load_workbook(qb_path, data_only=True)
    rows = list(wb.active.iter_rows(values_only=True))

    records: list[McqRecord] = []
    stratified_products = {
        p for p, rule in PRODUCT_SAMPLING_RULES.items() if rule.get("mode") == "stratified"
    }

    for product_key, section_rows in _split_product_sections(rows):
        if product_key in stratified_products:
            records.extend(_parse_category_section(product_key, section_rows))
        else:
            records.extend(_parse_simple_section(product_key, section_rows))

    unique_records = dedupe_records(records)
    pools: dict[str, list[McqRecord]] = defaultdict(list)
    for rec in unique_records:
        pools[rec.product].append(rec)
    return dict(pools), unique_records


def _category_pool_map(records: list[McqRecord]) -> dict[str, list[McqRecord]]:
    by_cat: dict[str, list[McqRecord]] = defaultdict(list)
    for rec in records:
        by_cat[normalize_category_key(rec.category).lower()].append(rec)
    return by_cat


def _find_category_pool(by_cat: dict[str, list[McqRecord]], label: str) -> list[McqRecord]:
    target = normalize_category_key(label).lower()
    if target in by_cat:
        return by_cat[target]
    for key, pool in by_cat.items():
        if key == target or target in key or key in target:
            return pool
    return []


def sample_questions_for_product(
    product_key: str,
    pool: list[McqRecord],
    *,
    employee_id: str | None = None,
) -> tuple[list[McqRecord], str]:
    rule = PRODUCT_SAMPLING_RULES.get(product_key)
    if not rule:
        return [], f"No sampling rule configured for product '{product_key}'."
    if not pool:
        return [], f"No questions found in QB-new.xlsx for product '{product_key}'."

    rng = random.Random()
    rng.seed(f"{employee_id or 'default'}:{product_key}")

    if rule["mode"] == "random":
        count = min(rule["count"], len(pool))
        picked = rng.sample(pool, count) if len(pool) >= count else list(pool)
        remark = "" if len(picked) >= rule["count"] else f"Only {len(picked)} questions in pool (expected up to {rule['count']})."
        rng.shuffle(picked)
        return picked, remark

    picked: list[McqRecord] = []
    shortfalls: list[str] = []
    by_cat = _category_pool_map(pool)

    for cat_label, need in rule["categories"]:
        cat_pool = dedupe_records(_find_category_pool(by_cat, cat_label))
        if not cat_pool:
            shortfalls.append(f"{cat_label}: 0 available")
            continue
        take = min(need, len(cat_pool))
        picked.extend(rng.sample(cat_pool, take))
        if take < need:
            shortfalls.append(f"{cat_label}: {take}/{need}")

    picked = dedupe_records(picked)
    rng.shuffle(picked)

    remark = ""
    if shortfalls:
        remark = "Category shortfall — " + "; ".join(shortfalls)
    if len(picked) < rule["total"]:
        extra = f"Assigned {len(picked)}/{rule['total']} questions."
        remark = f"{remark} {extra}".strip()

    return picked, remark.strip()


def assign_display_questions(
    product_key: str,
    pool: list[McqRecord],
    *,
    employee_id: str | None = None,
    limit: int = QUESTIONS_PER_EMPLOYEE,
) -> tuple[list[str], str]:
    picked, remark = sample_questions_for_product(product_key, pool, employee_id=employee_id)
    display = [rec.display_text for rec in picked]
    if len(display) < limit:
        display.extend([""] * (limit - len(display)))
    else:
        display = display[:limit]
    return display, remark


def normalize_lookup_key(text: str) -> str:
    text = clean(text).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def build_alias_bank(qb_path: Path) -> dict[str, dict]:
    """Build normalized-text lookup for MCQ records (used by import/reassign scripts)."""
    _pools, records = parse_qb_new_xlsx(qb_path)
    alias_bank: dict[str, dict] = {}
    for rec in records:
        plain = rec.question_text
        display = rec.display_text
        item = {
            "question_text": display,
            "plain_text": plain,
            "options": list(rec.options),
            "correct_option_index": rec.correct_option_index,
            "explanation": "Imported from QB-new.xlsx.",
            "difficulty": "medium",
            "product": rec.product,
            "category": rec.category,
            "topic_title": rec.category or rec.product,
        }
        for text in (display, plain):
            key = normalize_lookup_key(text)
            if key not in alias_bank:
                alias_bank[key] = item
    return alias_bank


def mcq_to_export_rows(records: Iterable[McqRecord]) -> list[list]:
    rows: list[list] = []
    for item in sorted(records, key=lambda x: (x.product, x.category, x.question_text)):
        for idx, option in enumerate(item.options):
            rows.append(
                [
                    item.domain,
                    item.product,
                    item.category,
                    item.question_text,
                    option,
                    "Correct" if idx == item.correct_option_index else "Wrong",
                ]
            )
    return rows
