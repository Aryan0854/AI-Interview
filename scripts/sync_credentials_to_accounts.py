"""Sync Employee_User_Credentials.xlsx into employee-accounts.json for portal login."""
import base64
import hashlib
import json
import sys
import io
from pathlib import Path

import openpyxl

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
CREDENTIALS_FILE = ROOT / "Employee_User_Credentials.xlsx"
ACCOUNTS_FILE = ROOT / "src" / "data" / "employee-accounts.json"


def hash_password(password: str):
    salt = base64.b64encode(__import__("os").urandom(16)).decode("ascii")
    digest = hashlib.pbkdf2_hmac("sha512", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return base64.b64encode(digest).decode("ascii"), salt


def verify_password(password: str, salt: str, stored_hash: str) -> bool:
    digest = hashlib.pbkdf2_hmac("sha512", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    candidate = base64.b64encode(digest).decode("ascii")
    return candidate == stored_hash


def normalize_id(value) -> str:
    return str(value or "").strip().upper()


def load_credentials():
    wb = openpyxl.load_workbook(CREDENTIALS_FILE, data_only=True)
    rows = list(wb.active.iter_rows(values_only=True))
    header = [str(c or "").strip() for c in rows[0]]
    col = {name: idx for idx, name in enumerate(header)}

    required = ["Emp ID", "Employee Name", "Initial Password", "Nokia Email ID", "Role", "Domain", "Product"]
    missing = [name for name in required if name not in col]
    if missing:
        raise ValueError(f"Missing columns in credentials file: {missing}")

    users_by_id = {}
    for row in rows[1:]:
        emp_id = str(row[col["Emp ID"]] or "").strip()
        if not emp_id:
            continue
        norm_id = normalize_id(emp_id)
        users_by_id[norm_id] = {
            "employee_id": emp_id,
            "full_name": str(row[col["Employee Name"]] or "").strip(),
            "password": str(row[col["Initial Password"]] or "").strip(),
            "email": str(row[col["Nokia Email ID"]] or "").strip(),
            "role": str(row[col["Role"]] or "employee").strip() or "employee",
            "department": str(row[col["Domain"]] or row[col["Product"]] or "SDM").strip() or "SDM",
            "product": str(row[col["Product"]] or "").strip(),
            "assessment_only": True,
            "product_qb_eligible": True,
        }
    return list(users_by_id.values()), set(users_by_id.keys())


def main():
    if not CREDENTIALS_FILE.exists():
        print(f"ERROR: Missing {CREDENTIALS_FILE.name}")
        sys.exit(1)

    print("Loading credentials from Excel...")
    credentials, qb_employee_ids = load_credentials()
    print(f"Found {len(credentials)} resources credential rows.")

    store = {"employees": []}
    if ACCOUNTS_FILE.exists():
        store = json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))

    account_map = {
        normalize_id(acc.get("employee_id")): acc
        for acc in store.get("employees", [])
        if acc.get("employee_id")
    }

    created = 0
    updated_password = 0
    updated_profile = 0
    already_valid = 0
    full_portal_enabled = 0
    full_portal_restored = 0

    for user in credentials:
        norm_id = normalize_id(user["employee_id"])
        existing = account_map.get(norm_id)

        if not existing:
            password_hash, password_salt = hash_password(user["password"])
            account_map[norm_id] = {
                "employee_id": user["employee_id"],
                "full_name": user["full_name"] or user["employee_id"],
                "email": user["email"],
                "department": user["department"],
                "role": user["role"],
                "product": user.get("product", ""),
                "assessment_only": True,
                "product_qb_eligible": True,
                "is_first_login": True,
                "password_hash": password_hash,
                "password_salt": password_salt,
                "xp_points": 0,
                "streak_days": 0,
                "skill_level": "beginner",
                "ai_readiness_score": 0,
            }
            created += 1
            full_portal_enabled += 1
            continue

        changed = False
        if user["full_name"] and existing.get("full_name") != user["full_name"]:
            existing["full_name"] = user["full_name"]
            changed = True
        if user["email"] and existing.get("email") != user["email"]:
            existing["email"] = user["email"]
            changed = True
        if user["role"] and existing.get("role") != user["role"]:
            existing["role"] = user["role"]
            changed = True
        if user["department"] and existing.get("department") != user["department"]:
            existing["department"] = user["department"]
            changed = True
        if user.get("product") is not None and existing.get("product") != user["product"]:
            existing["product"] = user["product"]
            changed = True
        if existing.get("product_qb_eligible") is not True:
            existing["product_qb_eligible"] = True
            changed = True
        if existing.get("assessment_only") is not True:
            existing["assessment_only"] = True
            changed = True
            full_portal_enabled += 1

        has_hash = bool(existing.get("password_hash") and existing.get("password_salt"))
        password_ok = (
            has_hash
            and user["password"]
            and verify_password(
                user["password"],
                existing.get("password_salt", ""),
                existing.get("password_hash", ""),
            )
        )

        if not password_ok:
            password_hash, password_salt = hash_password(user["password"])
            existing["password_hash"] = password_hash
            existing["password_salt"] = password_salt
            existing["is_first_login"] = True
            updated_password += 1
            changed = True
        elif changed:
            updated_profile += 1
        else:
            already_valid += 1

        account_map[norm_id] = existing

    qb_disabled = 0
    for norm_id, existing in account_map.items():
        if norm_id in qb_employee_ids:
            continue
        if existing.get("role") == "admin":
            continue
        if existing.get("assessment_only") is True:
            existing["assessment_only"] = False
            full_portal_restored += 1
        if existing.get("product_qb_eligible") is not False:
            existing["product_qb_eligible"] = False
            qb_disabled += 1

    updated_store = {"employees": list(account_map.values())}
    ACCOUNTS_FILE.write_text(json.dumps(updated_store, indent=2), encoding="utf-8")

    print(f"Created: {created}")
    print(f"Updated password/hash: {updated_password}")
    print(f"Updated profile only: {updated_profile}")
    print(f"Already valid: {already_valid}")
    print(f"Full portal enabled (resources cohort): {full_portal_enabled}")
    print(f"QB access disabled (non-resources): {qb_disabled}")
    print(f"Total accounts in store: {len(updated_store['employees'])}")
    print(f"Saved to {ACCOUNTS_FILE}")

    verify_store = json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))
    verify_map = {
        normalize_id(acc.get("employee_id")): acc
        for acc in verify_store.get("employees", [])
    }
    failures = []
    for user in credentials:
        norm_id = normalize_id(user["employee_id"])
        acc = verify_map.get(norm_id)
        if not acc:
            failures.append((user["employee_id"], "missing account"))
            continue
        if not acc.get("password_hash") or not acc.get("password_salt"):
            failures.append((user["employee_id"], "missing password hash"))
            continue
        if acc.get("product_qb_eligible") is not True:
            failures.append((user["employee_id"], "product_qb_eligible not enabled"))
            continue
        if not verify_password(
            user["password"],
            acc.get("password_salt", ""),
            acc.get("password_hash", ""),
        ):
            failures.append((user["employee_id"], "password mismatch"))

    if failures:
        print(f"VERIFICATION FAILED for {len(failures)} users:")
        for item in failures[:10]:
            print(" ", item)
        sys.exit(1)

    print(f"VERIFIED: All {len(credentials)} resources credentials have full portal access.")


if __name__ == "__main__":
    main()
