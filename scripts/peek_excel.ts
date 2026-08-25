import ExcelJS from 'exceljs';

async function run() {
  try {
    const qb = new ExcelJS.Workbook();
    await qb.xlsx.readFile('c:/Users/aryanmi/OneDrive - Infinite Computer Solutions (India) Limited/Desktop/Interviee/Question Bank-20th July \'26.xlsx');
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
