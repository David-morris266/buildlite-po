/**
 * BL-033D.x.1 — source non-interference (no clone, no CVR writes).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FILES = [
  "services/prelimsForecastEngine.js",
  "services/prelimsItemRepository.js",
  "services/cvrCloseFormulas.js",
  "services/cvrSnapshotMapper.js",
  "services/costCodeClassificationRepository.js",
  "services/developmentProgrammeRepository.js",
  "migrations/013_cost_code_classifications.sql",
  "migrations/014_development_programme.sql",
  "migrations/015_development_prelims_items.sql",
];

test("company templates do not enter D.1 engine, CVR, snapshot, programme, or classification", () => {
  const interference = /client_prelims_templates|BUILDLITE_STANDARD_PRELIMS|Review & Adopt/;
  for (const rel of FILES) {
    const sql = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.equal(interference.test(sql), false, rel);
  }
  const dx1 = fs.readFileSync(path.join(ROOT, "services/prelimsTemplateRepository.js"), "utf8");
  assert.equal(/INSERT INTO development_prelims_items/.test(dx1), false);
  assert.equal(/Review & Adopt/.test(dx1), false);
  assert.equal(/UPDATE cost_codes/.test(dx1), false);
  assert.equal(/INSERT INTO cost_code_classifications/.test(dx1), false);
  const routes = fs.readFileSync(path.join(ROOT, "routes/prelimsTemplateRoutes.js"), "utf8");
  assert.equal(/Review & Adopt/.test(routes), false);
  assert.equal(/Setup from Template/.test(routes), false);
});
