import openpyxl

wb = openpyxl.load_workbook("docs/Question Banks/Question Bank-20th July '26.xlsx", data_only=True)
sheet_cmg = wb['CMG']
rows = list(sheet_cmg.iter_rows(values_only=True))
print("CMG Sheet row count:", len(rows))
print("CMG Header:", rows[0])
qs = [r[2] for r in rows[1:] if r[2]]
print("Total q values in CMG:", len(qs))
print("Unique q values in CMG:", len(set(qs)))
for q in qs[:5]:
    print("  Q sample:", repr(q))
