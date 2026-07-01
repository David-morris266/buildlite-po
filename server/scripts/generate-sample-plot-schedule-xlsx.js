/**
 * Sample plot schedule spreadsheet for BL-009A.02 import testing.
 */
const fs = require("fs");
const path = require("path");
const XLSX = require(path.join(__dirname, "..", "..", "client", "node_modules", "xlsx"));

const OUT_DIR = path.join(__dirname, "..", "..", "docs", "samples");
const OUT_FILE = path.join(OUT_DIR, "buildlite-plot-schedule-sample.xlsx");

const rows = [
  ["Plot No", "House Type", "Bedrooms", "GIA", "Phase", "Tenure"],
  ["1", "The Maple", 3, 92.5, "Phase 1", "Freehold"],
  ["2", "The Maple", 3, 92.5, "Phase 1", "Freehold"],
  ["3", "The Birch", 4, 108.2, "Phase 1", "Freehold"],
  ["4", "The Birch", 4, 108.2, "Phase 1", "Shared Ownership"],
  ["5", "The Oak", 2, 78.0, "Phase 2", "Freehold"],
];

fs.mkdirSync(OUT_DIR, { recursive: true });
const sheet = XLSX.utils.aoa_to_sheet(rows);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "Plot Schedule");
XLSX.writeFile(workbook, OUT_FILE);
console.log("Wrote", OUT_FILE);
