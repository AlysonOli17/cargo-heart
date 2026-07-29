const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'USINA.xlsx');
const wb = XLSX.readFile(filePath);

console.log('\n=== SHEETS FOUND ===');
console.log(wb.SheetNames);

wb.SheetNames.forEach((sheetName) => {
  const ws = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  
  console.log(`\n=== SHEET: "${sheetName}" ===`);
  console.log(`Dimensions: ${range.e.r + 1} rows x ${range.e.c + 1} cols`);

  // Print first 30 rows raw to understand structure
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true });
  console.log('\n--- First 40 rows (raw) ---');
  rows.slice(0, 40).forEach((row, i) => {
    // Filter out totally empty rows
    const hasContent = row.some(c => c !== '' && c !== null && c !== undefined);
    if (hasContent) {
      console.log(`Row ${i + 1}: ${JSON.stringify(row)}`);
    } else {
      console.log(`Row ${i + 1}: [empty]`);
    }
  });

  console.log('\n--- Column headers detection (row 1-5) ---');
  for (let r = 0; r < Math.min(5, range.e.r + 1); r++) {
    const rowData = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      rowData.push(cell ? cell.v : '');
    }
    const hasContent = rowData.some(c => c !== '' && c !== null);
    if (hasContent) console.log(`Row ${r+1} headers: ${JSON.stringify(rowData)}`);
  }
});
