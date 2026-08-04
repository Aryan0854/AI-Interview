"""Quick check: sample assigned questions for an employee in Supabase."""
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env.local"

for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
h = {"apikey": key, "Authorization": f"Bearer {key}"}

code = sys.argv[1] if len(sys.argv) > 1 else "1041842"
emp = requests.get(
    f"{url}/rest/v1/employees",
    headers=h,
    params={"employee_id": f"eq.{code}", "select": "id,full_name"},
    timeout=30,
).json()[0]
test = requests.get(
    f"{url}/rest/v1/tests",
    headers=h,
    params={
        "employee_id": f"eq.{emp['id']}",
        "topic_id": "eq.resource-product-assessment",
        "select": "id,status,total_questions",
    },
    timeout=30,
).json()[0]
qs = requests.get(
    f"{url}/rest/v1/test_questions",
    headers=h,
    params={
        "test_id": f"eq.{test['id']}",
        "select": "question_text",
        "order": "question_index.asc",
    },
    timeout=30,
).json()

print(f"{emp.get('full_name')} ({code}) — status={test['status']}, questions={len(qs)}")
for q in qs[:3]:
    print(f"  • {q['question_text'][:110]}")
old = [q for q in qs if "HSSHLR Non Functional" in q["question_text"]]
print(f"Old deployment-style questions: {len(old)}")
