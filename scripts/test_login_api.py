import urllib.request
import json

url = "http://localhost:3000/api/employee/auth/login"

def test_login(emp_id, pwd, label):
    data = json.dumps({"employee_id": emp_id, "password": pwd}).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            body = json.loads(resp.read().decode('utf-8'))
            print(f"[{label}] Status: {resp.status} Response: {body}")
    except urllib.error.HTTPError as e:
        body = json.loads(e.read().decode('utf-8'))
        print(f"[{label}] HTTP {e.code} Error: {body}")

print("=== TESTING LOGIN API ===")
test_login("1028485", "", "Blank Password")
test_login("1028485", "EMP@Emmanuel8485", "Initial Password")
test_login("1028485", "1028485", "Employee ID as Password")
test_login("1028485", "wrongpass", "Wrong Password")
