/**
 * Sample plot × stage plumbing valuation matrix for BL-011C.02 import testing.
 */
const fs = require("fs");
const path = require("path");
const XLSX = require(path.join(__dirname, "..", "..", "client", "node_modules", "xlsx"));

const OUT_DIR = path.join(__dirname, "..", "..", "docs", "samples");
const OUT_FILE = path.join(OUT_DIR, "buildlite-plumbing-matrix-sample.xlsx");

const rows = [
  [
    "Plot",
    "Foundations",
    "Brick to DPC",
    "Superstructure",
    "1st Fix",
    "2nd Fix",
    "Final Fix",
  ],
  ["Plot 1", 2500, 1800, 8200, 6500, 4000, 2000],
  ["Plot 2", 2500, 1800, 8200, 6500, 4000, 2000],
];

fs.mkdirSync(OUT_DIR, { recursive: true });
const sheet = XLSX.utils.aoa_to_sheet(rows);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "Plumbing");
XLSX.writeFile(workbook, OUT_FILE);
console.log("Wrote", OUT_FILE);
