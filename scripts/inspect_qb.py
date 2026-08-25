import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import openpyxl
import re

def normalize(s):
    if s is None:
        return ''
    s = str(s).strip()
    s = re.sub(r'[^a-zA-Z0-9]+', ' ', s)
    s = re.sub(r'\s+', ' ', s)
    return s.lower().strip()

from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from qb_new_parser import parse_qb_new_xlsx

_pools, records = parse_qb_new_xlsx(Path(__file__).resolve().parents[1] / "excel" / "QB-new.xlsx")
products = sorted({r.product for r in records})
print("QB-new products:", products)
for product in products:
    count = sum(1 for r in records if r.product == product)
    print(f"  {product}: {count} questions")

wb1 = openpyxl.load_workbook('Resource details less tahn 3.5 rating.xlsx', data_only=True)
sheet1 = wb1.active
emp_rows = list(sheet1.iter_rows(values_only=True))

emp_prods = set()
for r in emp_rows[1:]:
    p = r[4]
    if p:
        emp_prods.add(str(p).strip())

print("\n--- ALL EMP PRODUCTS vs SHET NAMES & PROD COLS ---")
for ep in sorted(list(emp_prods)):
    print(f"Emp product: {ep} | Normalized: {normalize(ep)}")
