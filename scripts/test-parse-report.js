const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const fileArg = process.argv[2] || path.join(process.env.USERPROFILE || "", "Downloads", "Project Statistics (2).xlsx");

function serializeExcelCellValue(cell) {
  if (!cell) return "";
  const value = cell.v;
  if (value instanceof Date) return value.toISOString();
  if (cell.w !== undefined && cell.w !== null && cell.w !== "") return cell.w;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function decodeSheetRange(sheet) {
  if (!sheet) return null;
  if (sheet["!ref"]) return XLSX.utils.decode_range(sheet["!ref"]);

  const addresses = Object.keys(sheet).filter((key) => /^[A-Z]+\d+$/.test(key));
  if (!addresses.length) return null;

  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = 0;
  let maxCol = 0;

  addresses.forEach((address) => {
    const { r, c } = XLSX.utils.decode_cell(address);
    minRow = Math.min(minRow, r);
    minCol = Math.min(minCol, c);
    maxRow = Math.max(maxRow, r);
    maxCol = Math.max(maxCol, c);
  });

  return { s: { r: minRow, c: minCol }, e: { r: maxRow, c: maxCol } };
}

function sheetToFullGrid(sheet) {
  const range = decodeSheetRange(sheet);
  if (!range) return [];

  const rows = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row = [];
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      row.push(serializeExcelCellValue(sheet[address]));
    }
    rows.push(row);
  }

  return rows;
}

function buildExcelColumnKeys(headerRow) {
  const keys = [];
  const seen = new Map();

  headerRow.forEach((cell, index) => {
    const trimmed = String(cell ?? "").trim();
    const baseKey = trimmed || `Column ${index + 1}`;
    const count = seen.get(baseKey) || 0;
    keys.push(count ? `${baseKey} (${count + 1})` : baseKey);
    seen.set(baseKey, count + 1);
  });

  return keys;
}

function gridRowToRecord(row, columnKeys) {
  const record = {};
  const columnCount = Math.max(columnKeys.length, row.length);

  for (let index = 0; index < columnCount; index += 1) {
    const key = columnKeys[index] || `Column ${index + 1}`;
    const value = row[index];
    record[key] = value === null || value === undefined ? "" : value;
  }

  return record;
}

function parseExcelReport(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheets = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const grid = sheetToFullGrid(sheet);
    const columnKeys = grid.length ? buildExcelColumnKeys(grid[0]) : [];
    const rows = grid.map((row, index) => ({
      rowIndex: index + 1,
      rowData: gridRowToRecord(row, columnKeys)
    }));

    sheets.push({
      sheetName,
      ref: sheet["!ref"] || "(inferred)",
      rowCount: rows.length,
      columnCount: columnKeys.length,
      rows
    });
  });

  return sheets;
}

if (!fs.existsSync(fileArg)) {
  console.error(`File not found: ${fileArg}`);
  process.exit(1);
}

const sheets = parseExcelReport(fs.readFileSync(fileArg));
let totalRows = 0;

sheets.forEach((sheet) => {
  totalRows += sheet.rowCount;
  console.log(`${sheet.sheetName}: ref=${sheet.ref}, rows=${sheet.rowCount}, cols=${sheet.columnCount}`);
  if (sheet.rows[0]) {
    console.log(`  header keys: ${Object.keys(sheet.rows[0].rowData).slice(0, 6).join(", ")}`);
  }
  if (sheet.rows[1]) {
    console.log(`  first data row: ${JSON.stringify(sheet.rows[1].rowData).slice(0, 120)}...`);
  }
});

console.log(`TOTAL PARSED ROWS: ${totalRows}`);
if (!totalRows) {
  process.exit(2);
}
