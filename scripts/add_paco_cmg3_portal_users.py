"""
Add 3 PACO/CMG people to Employee Portal (not Corp Pool).

Remaps Emp IDs 1040529 and 1040522 to Abirami / Likitha as requested,
and adds 1042170 Vivek Kumar. Assigns CMG questions and first-login passwords.
"""
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from add_paco_phase2_portal_users import (  # noqa: E402
    ACCOUNTS_FILE,
    PROFILES_FILE,
    QB_FILE,
    QUESTIONS_PER_EMPLOYEE,
    SUBJECT_ID,
    SUBJECT_TITLE,
    TIME_LIMIT_SECONDS,
    append_credentials_rows,
    append_local_tests,
    assign_display_questions,
    build_bank_index,
    clean,
    generate_password,
    hash_password,
    load_json,
    normalize_question_key,
    parse_qb_new_xlsx,
    save_json,
    upsert_supabase_employee,
)
from reassign_test_questions_supabase import TOPIC_ID, SupabaseClient, load_env  # noqa: E402

PEOPLE = [
    {
        "employee_id": "1040529",
        "full_name": "Abirami M",
        "email": "abirami.m.ext@nokia.com",
        "infinite_email": "Abirami.Elam@infinite.com",
        "domain": "PACO",
        "product": "CMG",
        "role": "employee",
        "ddh": "",
        "remap": True,
    },
    {
        "employee_id": "1040522",
        "full_name": "Likitha Manda",
        "email": "manda.likhitha.ext@nokia.com",
        "infinite_email": "Likhitha.Manda@infinite.com",
        "domain": "PACO",
        "product": "CMG",
        "role": "employee",
        "ddh": "",
        "remap": True,
    },
    {
        "employee_id": "1042170",
        "full_name": "Vivek Kumar",
        "email": "vivek.12.kumar.ext@nokia.com",
        "infinite_email": "Vivek.Kumar8@infinite.com",
        "domain": "PACO",
        "product": "CMG",
        "role": "employee",
        "ddh": "",
        "remap": False,
    },
]


def raise_for_status(resp, action: str) -> None:
    if resp.ok:
        return
    raise RuntimeError(f"{action} failed {resp.status_code}: {resp.text}")


def dump_existing(client: SupabaseClient, emp_id: str, email: str) -> None:
    by_id = client.get(
        "employees",
        {
            "employee_id": f"eq.{emp_id}",
            "select": "id,employee_id,full_name,email,product,product_qb_eligible,assessment_only",
            "limit": "1",
        },
    )
    by_email = client.get(
        "employees",
        {
            "email": f"eq.{email}",
            "select": "id,employee_id,full_name,email,product,product_qb_eligible",
            "limit": "5",
        },
    )
    print(f"  DB by id {emp_id}: {by_id}")
    print(f"  DB by email {email}: {by_email}")
    if by_id:
        tests = client.get(
            "tests",
            {
                "employee_id": f"eq.{by_id[0]['id']}",
                "select": "id,status,topic_id,topic_title,employee_code,started_at,completed_at",
                "limit": "20",
            },
        )
        print(f"  existing tests: {tests}")


def email_taken_by_other(client: SupabaseClient, email: str, emp_id: str) -> bool:
    rows = client.get(
        "employees",
        {
            "email": f"eq.{email}",
            "select": "employee_id,full_name,email",
            "limit": "5",
        },
    )
    return any(clean(r.get("employee_id")) != emp_id for r in rows)


def replace_or_create_test(
    client: SupabaseClient,
    employee_uuid: str,
    emp: dict,
    matched: list[dict],
    test_id: str,
) -> None:
    existing = client.get(
        "tests",
        {
            "employee_id": f"eq.{employee_uuid}",
            "topic_id": f"eq.{TOPIC_ID}",
            "select": "id,status,started_at,employee_code",
            "limit": "50",
        },
    )
    for row in existing:
        tid = row["id"]
        print(f"  removing leftover test {tid} status={row.get('status')} code={row.get('employee_code')}")
        try:
            client.delete("test_attempts", {"test_id": f"eq.{tid}"})
        except Exception as err:
            print(f"  warn delete test_attempts: {err}")
        client.delete("test_questions", {"test_id": f"eq.{tid}"})
        client.delete("tests", {"id": f"eq.{tid}"})

    now = datetime.now(timezone.utc).isoformat()
    resp = requests.post(
        f"{client.base}/tests",
        headers=client.headers,
        json=[
            {
                "id": test_id,
                "employee_id": employee_uuid,
                "employee_code": emp["employee_id"],
                "topic_id": TOPIC_ID,
                "subject_id": SUBJECT_ID,
                "topic_title": emp["product"],
                "subject_title": SUBJECT_TITLE,
                "difficulty": "medium",
                "total_questions": len(matched),
                "time_limit_seconds": TIME_LIMIT_SECONDS,
                "status": "pending",
                "current_question_index": 0,
            }
        ],
        timeout=60,
    )
    raise_for_status(resp, f"POST tests {emp['employee_id']}")
    payload = []
    for idx, q in enumerate(matched):
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
                "topic_title": q.get("category") or q.get("topic_title") or emp["product"],
                "created_at": now,
            }
        )
    for i in range(0, len(payload), 50):
        client.post("test_questions", payload[i : i + 50])
    print(f"  created CMG test {test_id} ({len(matched)} questions)")


def main() -> int:
    if not QB_FILE.exists():
        print(f"ERROR: missing {QB_FILE}")
        return 1

    url, key = load_env()
    client = SupabaseClient(url, key)

    print("=== Existing Supabase rows ===")
    for emp in PEOPLE:
        dump_existing(client, emp["employee_id"], emp["email"])

    pools, mcq_records = parse_qb_new_xlsx(QB_FILE)
    bank = build_bank_index(mcq_records)
    now = datetime.now(timezone.utc).isoformat()

    accounts = load_json(ACCOUNTS_FILE, {"employees": []})
    account_map = {
        clean(acc.get("employee_id")).upper(): acc
        for acc in accounts.get("employees", [])
        if acc.get("employee_id")
    }
    profiles = load_json(PROFILES_FILE, [])
    profile_map = {clean(row.get("employee_id")).upper(): row for row in profiles}

    new_tests = []
    new_questions = []
    new_manifest = []
    logins = []

    for emp in PEOPLE:
        product = emp["product"]
        pool = pools.get(product, [])
        assigned, remark = assign_display_questions(product, pool, employee_id=emp["employee_id"])
        assigned = [q for q in assigned if q]
        if len(assigned) < QUESTIONS_PER_EMPLOYEE:
            print(f"ERROR: {emp['employee_id']} only got {len(assigned)} {product} questions. {remark}")
            return 1

        matched = []
        for q_text in assigned:
            item = bank.get(normalize_question_key(q_text)) or bank.get(
                normalize_question_key(q_text.split("] ", 1)[-1])
            )
            if not item:
                print(f"ERROR: unmatched question for {emp['employee_id']}: {q_text[:120]}")
                return 1
            matched.append({**item, "question_text": q_text})

        emp["password"] = generate_password(emp["full_name"], emp["employee_id"])
        emp["password_hash"], emp["password_salt"] = hash_password(emp["password"])
        if email_taken_by_other(client, emp["email"], emp["employee_id"]):
            print(f"  Nokia email {emp['email']} already on another Emp ID; using Infinite email")
            emp["email"] = emp["infinite_email"]

        existing_acc = account_map.get(emp["employee_id"].upper(), {})
        previous_name = existing_acc.get("full_name") or "(new)"
        account = {
            **existing_acc,
            "employee_id": emp["employee_id"],
            "full_name": emp["full_name"],
            "email": emp["email"],
            "department": emp["domain"],
            "role": emp["role"],
            "product": product,
            "assessment_only": True,
            "product_qb_eligible": True,
            "is_first_login": True,
            "password_hash": emp["password_hash"],
            "password_salt": emp["password_salt"],
            "xp_points": existing_acc.get("xp_points", 0),
            "streak_days": existing_acc.get("streak_days", 0),
            "skill_level": existing_acc.get("skill_level", "beginner"),
            "ai_readiness_score": existing_acc.get("ai_readiness_score", 0),
        }
        account_map[emp["employee_id"].upper()] = account
        emp["account"] = account
        emp["matched"] = matched

        profile_map[emp["employee_id"].upper()] = {
            "employee_id": emp["employee_id"],
            "full_name": emp["full_name"],
            "role": emp["role"],
            "domain": emp["domain"],
            "product": product,
            "email": emp["email"],
            "ddh": emp["ddh"],
            "emp_status": "Confirmed",
            "remarks": "PACO CMG portal add",
            "assigned_questions": assigned,
            "assigned_question_count": len(assigned),
        }

        test_id = str(uuid.uuid4())
        emp["test_id"] = test_id
        new_tests.append(
            {
                "id": test_id,
                "employee_id": emp["employee_id"],
                "employee_code": emp["employee_id"],
                "topic_id": TOPIC_ID,
                "subject_id": SUBJECT_ID,
                "difficulty": "medium",
                "total_questions": len(matched),
                "time_limit_seconds": TIME_LIMIT_SECONDS,
                "status": "pending",
                "current_question_index": 0,
                "started_at": None,
                "completed_at": None,
                "in_progress": None,
                "created_at": now,
                "topic_title": product,
                "subject_title": SUBJECT_TITLE,
            }
        )
        for idx, q in enumerate(matched):
            new_questions.append(
                {
                    "id": str(uuid.uuid4()),
                    "test_id": test_id,
                    "question_index": idx,
                    "question_text": q["question_text"],
                    "options": q["options"],
                    "correct_option_index": q["correct_option_index"],
                    "explanation": q["explanation"],
                    "difficulty": q["difficulty"],
                    "topic_id": TOPIC_ID,
                    "topic_title": q.get("category") or q["topic_title"],
                    "created_at": now,
                }
            )
        new_manifest.append(
            {
                "employee_id": emp["employee_id"],
                "full_name": emp["full_name"],
                "product": product,
                "test_id": test_id,
                "question_count": len(matched),
                "missing_questions": [],
            }
        )
        print(
            f"Prepared {emp['employee_id']} {previous_name} -> {emp['full_name']} "
            f"{product} ({len(matched)} Qs)"
        )

    accounts["employees"] = list(account_map.values())
    save_json(ACCOUNTS_FILE, accounts)
    save_json(PROFILES_FILE, list(profile_map.values()))
    append_credentials_rows(PEOPLE)
    append_local_tests(new_tests, new_questions, new_manifest)

    print("\n=== Syncing to Supabase Employee Portal ===")
    for emp in PEOPLE:
        employee_uuid = upsert_supabase_employee(client, emp, emp["account"])
        replace_or_create_test(client, employee_uuid, emp, emp["matched"], emp["test_id"])
        logins.append(emp)
        print(f"  synced {emp['employee_id']} {emp['full_name']}")

    print("\n=== Employee Portal logins ===")
    print("URL: https://ai-interview-ics-poc.vercel.app/employee")
    for emp in logins:
        print(f"{emp['employee_id']}  {emp['full_name']}  {emp['email']}  {emp['password']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
