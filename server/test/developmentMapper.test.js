const test = require("node:test");
const assert = require("node:assert/strict");
const {
  rowToDocument,
  mergeDevelopmentPatch,
  extractPayloadFromDocument,
} = require("../services/developmentMapper");

test("rowToDocument merges promoted columns with payload", () => {
  const doc = rowToDocument({
    id: "dev-1785599776666-zck5pl",
    client_id: "00000000-0000-0000-0000-000000000001",
    job_number: "DEV-001",
    development_name: "Test Site 1",
    status: "live",
    payload: {
      client: "Acme",
      plotMaster: { plots: [{ id: "plot-1", plotNumber: "1" }], updatedAt: "2026-01-01T00:00:00.000Z" },
      customField: "preserve-me",
    },
    version: 2,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    created_by: "tester",
    updated_by: "tester",
  });

  assert.equal(doc.id, "dev-1785599776666-zck5pl");
  assert.equal(doc.jobNumber, "DEV-001");
  assert.equal(doc.customField, "preserve-me");
  assert.equal(doc.plotMaster.plots.length, 1);
  assert.equal(doc.version, 2);
});

test("mergeDevelopmentPatch preserves plotMaster when not supplied", () => {
  const existing = {
    id: "dev-1",
    jobNumber: "DEV-001",
    developmentName: "Site",
    status: "planning",
    startDate: "2026-01-01",
    targetCompletion: "2026-12-31",
    plotMaster: {
      plots: [{ id: "plot-1", plotNumber: "1", houseType: "Detached" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };

  const merged = mergeDevelopmentPatch(existing, {
    startDate: "2026-02-01",
    targetCompletion: "2027-01-01",
  });

  assert.equal(merged.startDate, "2026-02-01");
  assert.equal(merged.plotMaster.plots.length, 1);
  assert.equal(merged.plotMaster.plots[0].houseType, "Detached");
});

test("extractPayloadFromDocument keeps unknown fields", () => {
  const payload = extractPayloadFromDocument({
    id: "dev-1",
    jobNumber: "DEV-001",
    developmentName: "Site",
    legacyMarker: "keep",
    plotCount: 3,
  });

  assert.equal(payload.legacyMarker, "keep");
  assert.equal(payload.plotCount, 3);
  assert.equal(payload.id, undefined);
});
