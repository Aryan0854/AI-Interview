"""
Replace assigned test questions in Supabase from Resource_Question_Mapping.xlsx + QB-new.xlsx.
Preserves existing test IDs; clears attempts and resets test status so employees can retake.

Usage:
  python scripts/reassign_test_questions_supabase.py --employees 1041842,1039668,1041185
  python scripts/reassign_test_questions_supabase.py --domain SDM
  python scripts/reassign_test_questions_supabase.py --all
  python scripts/reassign_test_questions_supabase.py --dry-run --domain SDM
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from import_resource_question_mapping import (  # noqa: E402
    TOPIC_ID,
    build_tests,
    load_mapping_rows,
    load_question_bank,
)

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env.local"


def load_env() -> tuple[str, str]:
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or ""
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        raise SystemExit("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
    return url.rstrip("/"), key


class SupabaseClient:
    def __init__(self, url: str, key: str) -> None:
        self.base = f"{url}/rest/v1"
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def get(self, table: str, params: dict) -> list[dict]:
        resp = requests.get(f"{self.base}/{table}", headers=self.headers, params=params, timeout=60)
        resp.raise_for_status()
        return resp.json()

    def delete(self, table: str, params: dict) -> None:
        resp = requests.delete(f"{self.base}/{table}", headers=self.headers, params=params, timeout=60)
        resp.raise_for_status()

    def post(self, table: str, rows: list[dict]) -> None:
        resp = requests.post(f"{self.base}/{table}", headers=self.headers, json=rows, timeout=120)
        resp.raise_for_status()

    def patch(self, table: str, params: dict, body: dict) -> None:
        resp = requests.patch(
            f"{self.base}/{table}",
            headers=self.headers,
            params=params,
            json=body,
            timeout=60,
        )
        resp.raise_for_status()


def resolve_employee_uuid(client: SupabaseClient, employee_code: str) -> str | None:
    rows = client.get("employees", {"employee_id": f"eq.{employee_code}", "select": "id", "limit": "1"})
    return rows[0]["id"] if rows else None


def find_test_id(client: SupabaseClient, employee_uuid: str) -> str | None:
    rows = client.get(
        "tests",
        {
            "employee_id": f"eq.{employee_uuid}",
            "topic_id": f"eq.{TOPIC_ID}",
            "select": "id,status",
            "limit": "1",
        },
    )
    return rows[0]["id"] if rows else None


def reassign_one(
    client: SupabaseClient,
    *,
    employee_code: str,
    matched_questions: list[dict],
    dry_run: bool,
) -> dict:
    result = {"employee_id": employee_code, "status": "skipped", "reason": ""}
    if not matched_questions:
        result["reason"] = "No matched questions"
        return result

    employee_uuid = resolve_employee_uuid(client, employee_code)
    if not employee_uuid:
        result["reason"] = "Employee not found in Supabase"
        return result

    test_id = find_test_id(client, employee_uuid)
    if not test_id:
        result["reason"] = "Assigned test not found in Supabase"
        return result

    result["test_id"] = test_id
    result["question_count"] = len(matched_questions)

    if dry_run:
        result["status"] = "dry_run"
        result["sample_question"] = matched_questions[0]["question_text"][:120]
        return result

    client.delete("test_attempts", {"test_id": f"eq.{test_id}"})
    client.delete("test_questions", {"test_id": f"eq.{test_id}"})

    now = datetime.now(timezone.utc).isoformat()
    payload = []
    for idx, q in enumerate(matched_questions):
        payload.append(
            {
                "id": str(uuid.uuid4()),
                "test_id": test_id,
                "question_index": idx,
                "question_text": q["question_text"],
                "options": q["options"],
                "correct_option_index": q["correct_option_index"],
                "explanation": q.get("explanation") or "Imported from QB-new.xlsx.",
                "difficulty": q.get("difficulty") or "medium",
                "topic_id": TOPIC_ID,
                "topic_title": q.get("category") or q.get("topic_title") or "",
                "created_at": now,
            }
        )

    for i in range(0, len(payload), 50):
        client.post("test_questions", payload[i : i + 50])

    client.patch(
        "tests",
        {"id": f"eq.{test_id}"},
        {
            "status": "pending",
            "in_progress": None,
            "current_question_index": 0,
            "started_at": None,
            "completed_at": None,
            "session_recording_url": None,
            "proctoring": None,
            "score_correct": None,
            "score_total": None,
            "score_percent": None,
            "ai_analysis": None,
            "total_questions": len(matched_questions),
        },
    )

    result["status"] = "updated"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Reassign Supabase test questions from QB-new mapping.")
    parser.add_argument("--employees", help="Comma-separated Emp IDs")
    parser.add_argument("--domain", help="Only employees in this domain (e.g. SDM)")
    parser.add_argument("--all", action="store_true", help="Process all mapped employees")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.all and not args.employees and not args.domain:
        parser.error("Specify --employees, --domain, or --all")

    url, key = load_env()
    client = SupabaseClient(url, key)

    print("Loading question bank and mapping...")
    bank = load_question_bank()
    employees = load_mapping_rows()
    print(f"Loaded {len(bank)} bank entries, {len(employees)} employees.")

    id_filter = None
    if args.employees:
        id_filter = {x.strip() for x in args.employees.split(",") if x.strip()}

    selected = []
    for emp in employees:
        code = emp["employee_id"]
        if id_filter and code not in id_filter:
            continue
        if args.domain and (emp.get("department") or "").strip().upper() != args.domain.strip().upper():
            continue
        selected.append(emp)

    if not selected:
        print("No employees matched filters.")
        return 1

    tests, test_questions, _manifest, stats = build_tests(selected, bank)
    questions_by_employee: dict[str, list[dict]] = {}
    test_id_by_employee = {t["employee_id"]: t["id"] for t in tests}
    for q in test_questions:
        test_id = q["test_id"]
        for emp_id, tid in test_id_by_employee.items():
            if tid == test_id:
                questions_by_employee.setdefault(emp_id, []).append(q)
                break

    print(f"Processing {len(selected)} employees{' (dry run)' if args.dry_run else ''}...")
    results = []
    ok = 0
    for emp in selected:
        code = emp["employee_id"]
        matched = sorted(
            questions_by_employee.get(code, []),
            key=lambda x: x.get("question_index", 0),
        )
        # build_tests stores full question dict in matched items via spread
        matched_payload = []
        for q in matched:
            matched_payload.append(
                {
                    "question_text": q["question_text"],
                    "options": q["options"],
                    "correct_option_index": q["correct_option_index"],
                    "explanation": q.get("explanation"),
                    "difficulty": q.get("difficulty"),
                    "category": q.get("topic_title"),
                    "topic_title": q.get("topic_title"),
                }
            )

        row = reassign_one(client, employee_code=code, matched_questions=matched_payload, dry_run=args.dry_run)
        results.append(row)
        if row["status"] in {"updated", "dry_run"}:
            ok += 1
        print(f"  {code}: {row['status']} — {row.get('reason') or row.get('sample_question', '')[:80]}")

    summary_path = ROOT / "uploads" / "reassign_questions_log.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(results, indent=2), encoding="utf-8")

    print(f"\nDone: {ok}/{len(selected)} processed. Log: {summary_path}")
    return 0 if ok == len(selected) else 1


if __name__ == "__main__":
    raise SystemExit(main())
