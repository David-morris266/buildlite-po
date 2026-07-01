/**
 * BL-011C.02 — Validate plot × stage import parsing.
 */
const fs = require("fs");
const path = require("path");
const XLSX = require(path.join(__dirname, "..", "..", "client", "node_modules", "xlsx"));

const SAMPLE = path.join(
  __dirname,
  "..",
  "..",
  "docs",
  "samples",
  "buildlite-plumbing-matrix-sample.xlsx"
);

function normaliseHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[£$€]/g, "")
    .replace(/\s+/g, " ");
}

function parseMoneyCell(value) {
  if (value == null || value === "") return null;
  const cleaned = String(value)
    .replace(/[£$€,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isBlankRow(values) {
  return values.every((cell) => !String(cell || "").trim());
}

function detectPlotStageLayout(rows, headerRowIndex = 0) {
  const headerRow = rows[headerRowIndex] || [];
  if (headerRow.length < 3) return false;
  const firstHeader = normaliseHeader(headerRow[0]);
  const plotAliases = ["plot", "unit", "plot no", "plot number", "plot no."];
  if (!plotAliases.some((alias) => firstHeader === alias || firstHeader.includes(alias))) {
    return false;
  }
  const stages = headerRow.slice(1).map((cell) => String(cell || "").trim()).filter(Boolean);
  if (stages.length < 2) return false;
  let plotRows = 0;
  for (const row of rows.slice(headerRowIndex + 1)) {
    if (isBlankRow(row)) continue;
    const plotLabel = String(row[0] || "").trim();
    if (!plotLabel) continue;
    const numericValues = row
      .slice(1, 1 + stages.length)
      .filter((cell) => parseMoneyCell(cell) != null);
    if (numericValues.length >= 1) plotRows += 1;
  }
  return plotRows >= 1;
}

function buildPlotStageImport(rows, headerRowIndex) {
  const headerRow = rows[headerRowIndex] || [];
  const stages = headerRow.slice(1).map((cell) => String(cell || "").trim()).filter(Boolean);
  const plots = [];
  for (const row of rows.slice(headerRowIndex + 1)) {
    if (isBlankRow(row)) continue;
    const label = String(row[0] || "").trim();
    if (!label) continue;
    plots.push({
      label,
      values: stages.map((_, index) => parseMoneyCell(row[index + 1]) || 0),
    });
  }
  return { layout: "plot-stage", stages, plots };
}

const workbook = XLSX.readFile(SAMPLE);
const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Plumbing, {
  header: 1,
  defval: "",
}).map((row) => (Array.isArray(row) ? row : []).map((cell) => String(cell ?? "").trim()));

if (!detectPlotStageLayout(rows, 0)) {
  console.error("FAIL: plot-stage layout not detected");
  process.exit(1);
}

const result = buildPlotStageImport(rows, 0);
if (result.plots.length !== 2 || result.stages.length !== 6) {
  console.error("FAIL: unexpected import shape", result);
  process.exit(1);
}

console.log("PASS: plot-stage import", {
  plots: result.plots.length,
  stages: result.stages.length,
  total: result.plots.reduce(
    (sum, plot) => sum + plot.values.reduce((s, v) => s + v, 0),
    0
  ),
});
