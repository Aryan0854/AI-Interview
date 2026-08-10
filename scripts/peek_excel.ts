import ExcelJS from 'exceljs';
import path from 'path';

async function run() {
  try {
    const qbPath = path.join(__dirname, '..', 'QB-new.xlsx');
    const qb = new ExcelJS.Workbook();
    await qb.xlsx.readFile(qbPath);
    console.log('QB-new.xlsx sheets:', qb.worksheets.map(ws => ws.name));
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
