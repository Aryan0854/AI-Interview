import ExcelJS from 'exceljs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const INPUT_EXCEL = path.join(process.cwd(), 'Resource details less tahn 3.5 rating.xlsx');
const OUTPUT_EXCEL = path.join(process.cwd(), 'Employee_User_Credentials.xlsx');
const OUTPUT_CSV = path.join(process.cwd(), 'Employee_User_Credentials.csv');
const ACCOUNTS_JSON = path.join(process.cwd(), 'src', 'data', 'employee-accounts.json');

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("base64");
  const hash = crypto.pbkdf2Sync(password, salt, 120_000, 64, "sha512").toString("base64");
  return { hash, salt };
}

function generatePassword(empName: string, empId: string): string {
  const cleanName = empName ? empName.trim().split(/\s+/)[0] : 'User';
  const cleanFirstName = cleanName.replace(/[^a-zA-Z]/g, '') || 'User';
  const cleanFirstNameCap = cleanFirstName.charAt(0).toUpperCase() + cleanFirstName.slice(1).toLowerCase();
  
  const cleanId = empId.replace(/\D/g, '');
  const last4 = cleanId.length >= 4 ? cleanId.slice(-4) : cleanId.padStart(4, '0');
  
  return `EMP@${cleanFirstNameCap}${last4}`;
}

async function run() {
  console.log('--- Generating Employee Credentials File ---');
  if (!fs.existsSync(INPUT_EXCEL)) {
    console.error('Input file not found:', INPUT_EXCEL);
    process.exit(1);
  }

  const wbInput = new ExcelJS.Workbook();
  await wbInput.xlsx.readFile(INPUT_EXCEL);
  const wsInput = wbInput.worksheets[0];

  const credentialsList: Array<{
    empId: string;
    empName: string;
    role: string;
    domain: string;
    product: string;
    customer: string;
    email: string;
    ddh: string;
    password: string;
  }> = [];

  const uniqueAccountMap = new Map<string, {
    empId: string;
    empName: string;
    role: string;
    domain: string;
    product: string;
    email: string;
    password: string;
  }>();

  wsInput.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    const empId = String(row.getCell(1).value || '').trim();
    const empName = String(row.getCell(2).value || '').trim();
    const role = String(row.getCell(3).value || '').trim();
    const domain = String(row.getCell(4).value || '').trim();
    const product = String(row.getCell(5).value || '').trim();
    const customer = String(row.getCell(6).value || '').trim();
    const email = String(row.getCell(7).value || '').trim();
    const ddh = String(row.getCell(8).value || '').trim();

    if (!empId && !empName) return;

    const password = generatePassword(empName, empId);

    credentialsList.push({
      empId,
      empName,
      role,
      domain,
      product,
      customer,
      email,
      ddh,
      password
    });

    const normId = empId.toUpperCase();
    if (!uniqueAccountMap.has(normId)) {
      uniqueAccountMap.set(normId, {
        empId,
        empName,
        role,
        domain,
        product,
        email,
        password
      });
    }
  });

  console.log(`Parsed ${credentialsList.length} total rows (${uniqueAccountMap.size} unique employee accounts).`);

  // 1. Create formatted Excel output file
  const wbOutput = new ExcelJS.Workbook();
  const wsOutput = wbOutput.addWorksheet('User Credentials');

  wsOutput.columns = [
    { header: 'Emp ID', key: 'empId', width: 16 },
    { header: 'Employee Name', key: 'empName', width: 28 },
    { header: 'Initial Password', key: 'password', width: 22 },
    { header: 'Nokia Email ID', key: 'email', width: 34 },
    { header: 'Role', key: 'role', width: 20 },
    { header: 'Domain', key: 'domain', width: 16 },
    { header: 'Product', key: 'product', width: 24 },
    { header: 'Customer', key: 'customer', width: 18 },
    { header: 'DDH Manager', key: 'ddh', width: 20 },
  ];

  // Header style
  const headerRow = wsOutput.getRow(1);
  headerRow.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '4F46E5' } // Indigo 600
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 28;

  // Add rows
  credentialsList.forEach((item) => {
    const r = wsOutput.addRow(item);
    r.font = { name: 'Segoe UI', size: 10 };
    r.getCell('password').font = { name: 'Consolas', size: 10, bold: true, color: { argb: '4338CA' } };
  });

  await wbOutput.xlsx.writeFile(OUTPUT_EXCEL);
  console.log(`Saved Excel file: ${OUTPUT_EXCEL}`);

  // 2. Create CSV output file
  const csvLines: string[] = [
    'Emp ID,Employee Name,Initial Password,Nokia Email ID,Role,Domain,Product,Customer,DDH Manager'
  ];
  credentialsList.forEach(item => {
    const esc = (val: string) => `"${val.replace(/"/g, '""')}"`;
    csvLines.push([
      esc(item.empId),
      esc(item.empName),
      esc(item.password),
      esc(item.email),
      esc(item.role),
      esc(item.domain),
      esc(item.product),
      esc(item.customer),
      esc(item.ddh)
    ].join(','));
  });
  fs.writeFileSync(OUTPUT_CSV, csvLines.join('\n'), 'utf8');
  console.log(`Saved CSV file: ${OUTPUT_CSV}`);

  // 3. Update employee-accounts.json store
  let existingStore: { employees: any[] } = { employees: [] };
  if (fs.existsSync(ACCOUNTS_JSON)) {
    try {
      existingStore = JSON.parse(fs.readFileSync(ACCOUNTS_JSON, 'utf8'));
    } catch (e) {
      console.warn('Failed to parse existing accounts store, creating new.');
    }
  }

  const existingMap = new Map<string, any>();
  (existingStore.employees || []).forEach((acc: any) => {
    if (acc && acc.employee_id) {
      existingMap.set(String(acc.employee_id).trim().toUpperCase(), acc);
    }
  });

  uniqueAccountMap.forEach((user, normId) => {
    const { hash, salt } = hashPassword(user.password);
    const existing = existingMap.get(normId);

    const updatedAccount = {
      employee_id: user.empId,
      full_name: user.empName,
      email: user.email,
      department: user.domain || user.product || 'SDM',
      role: user.role || 'employee',
      is_first_login: true,
      password_hash: hash,
      password_salt: salt,
      xp_points: existing?.xp_points || 0,
      streak_days: existing?.streak_days || 0,
      skill_level: existing?.skill_level || 'beginner',
      ai_readiness_score: existing?.ai_readiness_score || 0
    };

    existingMap.set(normId, updatedAccount);
  });

  const updatedEmployees = Array.from(existingMap.values());
  fs.writeFileSync(ACCOUNTS_JSON, JSON.stringify({ employees: updatedEmployees }, null, 2), 'utf8');
  console.log(`Updated accounts store (${updatedEmployees.length} total employee accounts in employee-accounts.json).`);

  console.log('--- Completed Credentials Generation Successfully ---');
}

run().catch((err) => {
  console.error('Error generating credentials:', err);
  process.exit(1);
});
