/**
 * Sample valuation spreadsheet for BL-011B.03 import testing.
 */
const fs = require("fs");
const path = require("path");
const XLSX = require(path.join(__dirname, "..", "..", "client", "node_modules", "xlsx"));

const OUT_DIR = path.join(__dirname, "..", "..", "docs", "samples");
const OUT_FILE = path.join(OUT_DIR, "buildlite-order-matrix-sample.xlsx");

const rows = [
  ["Description", "Order Value", "Notes", "Trade"],
  ["Earthworks", 85000, "Phase 1", "Groundworks"],
  ["Drainage", 42000, "", "Groundworks"],
  ["Brickwork", 121500, "Main envelope", "Brickwork"],
];

fs.mkdirSync(OUT_DIR, { recursive: true });
const sheet = XLSX.utils.aoa_to_sheet(rows);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "Valuation");
XLSX.writeFile(workbook, OUT_FILE);
console.log("Wrote", OUT_FILE);
