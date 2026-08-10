import openpyxl

wb = openpyxl.load_workbook("Resource details less tahn 3.5 rating.xlsx", data_only=True)
sheet = wb.active

unmatched_list = ['DM', 'EIR', 'HSS', 'MNP', 'NDS', 'NDS-SDL', 'ONE NDS/HSS/HLR', 'One NDS', 'Project TPM', 'Registers', 'SDM', 'SDM-CARE', 'TDL', 'TPM', 'TPM -CSD', 'TPM SDM', 'TPM-SDM', 'UDM-CARE']

print(f"{'Emp ID':<10} | {'Product':<25} | {'Domain':<15} | {'Role':<20}")
print("-" * 75)
for r in list(sheet.iter_rows(values_only=True))[1:]:
    p = str(r[4]).strip() if r[4] else ""
    if p in unmatched_list:
        emp_id = r[0]
        domain = r[3]
        role = r[2]
        print(f"{str(emp_id):<10} | {p:<25} | {str(domain):<15} | {str(role):<20}")
