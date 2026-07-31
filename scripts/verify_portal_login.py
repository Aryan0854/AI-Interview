"""Verify a sample of Excel credentials against the live login API."""
import hashlib
import base64
import json
import random
import sys
import urllib.error
import urllib.request
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
CREDENTIALS_FILE = ROOT / "Employee_User_Credentials.xlsx"
ACCOUNTS_FILE = ROOT / "src" / "data" / "employee-accounts.json"
LOGIN_URL = "http://localhost:3000/api/employee/auth/login"


def verify_password(password: str, salt: str, stored_hash: str) -> bool:
    digest = hashlib.pbkdf2_hmac("sha512", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return base64.b64encode(digest).decode("ascii") == stored_hash


def load_unique_credentials():
    wb = openpyxl.load_workbook(CREDENTIALS_FILE, data_only=True)
    rows = list(wb.active.iter_rows(values_only=True))[1:]
    users = {}
    for row in rows:
        emp_id = str(row[0] or "").strip()
        if not emp_id:
            continue
        users[emp_id.upper()] = {
            "employee_id": emp_id,
            "password": str(row[2] or "").strip(),
        }
    return list(users.values())


def try_login(employee_id: str, password: str):
    payload = json.dumps({"employee_id": employee_id, "password": password}).encode("utf-8")
    req = urllib.request.Request(
        LOGIN_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return resp.status, body.get("status"), None
    except urllib.error.HTTPError as exc:
        body = json.loads(exc.read().decode("utf-8"))
        return exc.code, None, body.get("error")


def main():
    credentials = load_unique_credentials()
    store = json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))
    account_map = {str(a["employee_id"]).upper(): a for a in store["employees"]}

    hash_failures = []
    for user in credentials:
        acc = account_map.get(user["employee_id"].upper())
        if not acc or not verify_password(user["password"], acc["password_salt"], acc["password_hash"]):
            hash_failures.append(user["employee_id"])

    if hash_failures:
        print(f"Hash verification failed for {len(hash_failures)} accounts.")
        sys.exit(1)

    sample_size = min(5, len(credentials))
    sample = random.sample(credentials, sample_size)
    api_failures = []
    for user in sample:
        status, login_status, error = try_login(user["employee_id"], user["password"])
        ok = status == 200 and login_status in {"ok", "first_time_modal"}
        if not ok:
            api_failures.append((user["employee_id"], status, error))
        print(f"{user['employee_id']}: {'OK' if ok else 'FAILED'} ({login_status or error})")

    if api_failures:
        print(f"Live login check failed for {len(api_failures)}/{sample_size} sampled accounts.")
        sys.exit(1)

    print(f"All {len(credentials)} accounts verified in store.")
    print(f"Live login API check passed for {sample_size} sampled accounts.")


if __name__ == "__main__":
    main()
