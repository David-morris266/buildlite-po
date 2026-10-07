/**
 * BL-033C — Programme validation and GET-seed mapping (no database).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePutProgrammeBody } = require("../services/developmentProgrammeValidation");
const {
  programmeRowToDocument,
  seedProgrammeFromDevelopment,
  toDateOnly,
} = require("../services/developmentProgrammeMapper");

test("PostgreSQL Date values map to strict four-digit programme dates", () => {
  assert.equal(toDateOnly(new Date(2027, 2, 1)), "2027-03-01");
  const early = new Date(0);
  early.setFullYear(27, 2, 1);
  early.setHours(0, 0, 0, 0);
  assert.equal(toDateOnly(early), null);
  assert.throws(() => programmeRowToDocument({
    id: "programme-1",
    development_id: "dev-1",
    site_start: early,
    first_completion: null,
    final_completion: new Date(2030, 7, 31),
    total_plots: 1,
    version: 1,
  }, "dev-1"), /site_start is not a supported calendar date/i);
});

test("programme PUT rejects malformed and impossible calendar dates", () => {
  for (const siteStart of ["27-03-01", "0027-03-01", "01/03/2027", "2027-02-29", "2027-04-31"]) {
    const result = validatePutProgrammeBody({
      version: 0,
      siteStart,
      finalCompletion: "2030-08-31",
      totalPlots: 31,
    });
    assert.equal(result.ok, false, siteStart);
  }
  assert.equal(validatePutProgrammeBody({
    version: 0,
    siteStart: "2028-02-29",
    finalCompletion: "2030-08-31",
    totalPlots: 31,
  }).ok, true);
});

test("malformed legacy seed dates fail closed without rewriting payload", () => {
  const seeded = seedProgrammeFromDevelopment({
    id: "dev-bad-seed",
    startDate: "27-03-01",
    targetCompletion: "2030-08-31",
    plotCount: 31,
  });
  assert.equal(seeded.siteStart, null);
  assert.equal(seeded.finalCompletion, "2030-08-31");
  assert.equal(seeded.exists, false);
});

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
