/**
 * BL-033C — Programme validation and GET-seed mapping (no database).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePutProgrammeBody } = require("../services/developmentProgrammeValidation");
const { seedProgrammeFromDevelopment } = require("../services/developmentProgrammeMapper");

test("Test Site 1 payload seed resolves without a programme row or firstCompletion", () => {
  const seeded = seedProgrammeFromDevelopment({
    id: "dev-1785599776666-zck5pl",
    startDate: "2026-09-01",
    targetCompletion: "2029-10-01",
    plotCount: 31,
  });
  assert.equal(seeded.exists, false);
  assert.equal(seeded.version, 0);
  assert.equal(seeded.siteStart, "2026-09-01");
  assert.equal(seeded.finalCompletion, "2029-10-01");
  assert.equal(seeded.totalPlots, 31);
  assert.equal(seeded.firstCompletion, null);
  assert.equal(seeded.durationMonths, 38);
});

test("seed ignores payload firstCompletion and does not invent dates", () => {
  const seeded = seedProgrammeFromDevelopment({
    id: "dev-seed",
    startDate: "2026-09-01",
    targetCompletion: "2029-10-01",
    plotCount: 31,
    firstCompletion: "2027-03-01",
  });
  assert.equal(seeded.firstCompletion, null);
});

test("nullable firstCompletion is accepted on PUT", () => {
  const result = validatePutProgrammeBody({
    version: 0,
    siteStart: "2026-09-01",
    finalCompletion: "2029-10-01",
    totalPlots: 31,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.firstCompletion, null);
  assert.equal(result.value.durationMonths, 38);
});

test("firstCompletion within programme bounds is accepted", () => {
  const result = validatePutProgrammeBody({
    version: 0,
    siteStart: "2026-09-01",
    firstCompletion: "2027-06-01",
    finalCompletion: "2029-10-01",
    totalPlots: 31,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.firstCompletion, "2027-06-01");
});

test("invalid chronology is rejected", () => {
  const inverted = validatePutProgrammeBody({
    version: 0,
    siteStart: "2029-10-01",
    finalCompletion: "2026-09-01",
    totalPlots: 31,
  });
  assert.equal(inverted.ok, false);
  assert.ok(inverted.errors.some((error) => /finalCompletion must be on or after siteStart/i.test(error)));
});

test("firstCompletion outside programme bounds is rejected", () => {
  const beforeStart = validatePutProgrammeBody({
    version: 0,
    siteStart: "2026-09-01",
    firstCompletion: "2026-08-01",
    finalCompletion: "2029-10-01",
    totalPlots: 31,
  });
  assert.equal(beforeStart.ok, false);

  const afterFinal = validatePutProgrammeBody({
    version: 0,
    siteStart: "2026-09-01",
    firstCompletion: "2029-11-01",
    finalCompletion: "2029-10-01",
    totalPlots: 31,
  });
  assert.equal(afterFinal.ok, false);
});
