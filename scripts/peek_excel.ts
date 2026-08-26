import ExcelJS from 'exceljs';

// NOTE: previously hardcoded to one contributor's local OneDrive path. Overridable via
// env var; defaults to a file placed at the project root so the script is portable.
const QUESTION_BANK_FILE = process.env.IMPORT_QUESTION_BANK_FILE || `${process.cwd()}/Question Bank-20th July '26.xlsx`;

async function run() {
  try {
    const qb = new ExcelJS.Workbook();
    await qb.xlsx.readFile(QUESTION_BANK_FILE);
    console.log('Question Bank Sheets:', qb.worksheets.map(ws => ws.name));
    const ws1 = qb.worksheets[0];
    console.log('Sheet 1 Headers:', ws1.getRow(1).values);
    for (let i = 2; i <= 6; i++) {
        console.log(`Row ${i}:`, ws1.getRow(i).values);
    }
  } catch (e) {
    console.error(e);
  }
}
run();
