const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCvrGiaSnapshotEvidence } = require("../services/cvrGiaSnapshotEvidence");
const { snapshotHeaderToDocument } = require("../services/cvrSnapshotMapper");

test("freezes active and inactive original Plot Master GIA with reconciled active total", () => {
  const evidence = buildCvrGiaSnapshotEvidence({ plotMaster: { plots: [
    { id: "p1", plotNumber: "1", status: "Active", gia: 1000.125 },
    { id: "p2", plotNumber: "2", status: "inactive", gia: 900 },
    { plotNumber: "3", gia: "1100.375" },
  ] } });
  assert.equal(evidence.availabilityState, "complete");
  assert.equal(evidence.totalPlotCount, 3);
  assert.equal(evidence.activePlotCount, 2);
  assert.equal(evidence.activePlotGiaCount, 2);
  assert.equal(evidence.totalActiveGia, "2100.5000");
  assert.equal(evidence.plots[1].active, false);
  assert.equal(evidence.plots[1].originalGia, "900.0000");
  assert.equal(evidence.plots[2].plotId, "plot-index:2");
});

test("incomplete GIA is captured without producing a usable denominator", () => {
  const evidence = buildCvrGiaSnapshotEvidence({ plotMaster: { plots: [
    { id: "p1", gia: 1000 }, { id: "p2", gia: "" }, { id: "p3", gia: -1 },
  ] } });
  assert.equal(evidence.availabilityState, "incomplete");
  assert.equal(evidence.activePlotCount, 3);
  assert.equal(evidence.activePlotGiaCount, 1);
  assert.equal(evidence.capturedValidActiveGia, "1000.0000");
  assert.equal(evidence.totalActiveGia, null);
  assert.deepEqual(evidence.plots.map((row) => row.invalidReason), [null, "missing", "non_positive"]);
});

for (const [values, expected] of [
  [[1076.4, 893.2], "1969.6000"],
  [[850.1, 920.2], "1770.3000"],
  [[1.23456, 2.34564], "3.5802"],
  [["10.00004", "0.00006"], "10.0001"],
]) {
  test(`uses exact four-decimal fixed-point reconciliation for ${JSON.stringify(values)}`, () => {
    const evidence = buildCvrGiaSnapshotEvidence({ plotMaster: { plots: values.map((gia, index) => ({ id: `p${index}`, gia })) } });
    assert.equal(evidence.availabilityState, "complete");
    assert.equal(evidence.totalActiveGia, expected);
  });
}

test("values rounding to zero are invalid and cannot create a GIA denominator", () => {
  const evidence = buildCvrGiaSnapshotEvidence({ plotMaster: { plots: [{ id: "tiny", gia: "0.00004" }] } });
  assert.equal(evidence.availabilityState, "incomplete");
  assert.equal(evidence.plots[0].originalGia, "0.0000");
  assert.equal(evidence.plots[0].invalidReason, "non_positive");
  assert.equal(evidence.totalActiveGia, null);
});

test("extreme and unrepresentable values fail closed without large exponent expansion", () => {
  const evidence = buildCvrGiaSnapshotEvidence({ plotMaster: { plots: [
    { id: "huge-exp", gia: "1e999999999" },
    { id: "numeric-overflow", gia: "1000000000000" },
    { id: "huge-text", gia: "9".repeat(300) },
  ] } });
  assert.equal(evidence.availabilityState, "incomplete");
  assert.equal(evidence.totalActiveGia, null);
  assert.deepEqual(evidence.plots.map((row) => row.invalidReason), ["out_of_range", "out_of_range", "out_of_range"]);
});

test("individually representable GIA rows with an unrepresentable total fail closed", () => {
  const evidence = buildCvrGiaSnapshotEvidence({ plotMaster: { plots: [
    { id: "large-1", gia: "600000000000.0000" },
    { id: "large-2", gia: "600000000000.0000" },
  ] } });
  assert.equal(evidence.plots.every((row) => row.giaValid), true);
  assert.deepEqual(evidence.plots.map((row) => row.originalGia), ["600000000000.0000", "600000000000.0000"]);
  assert.equal(evidence.availabilityState, "total_out_of_range");
  assert.equal(evidence.capturedValidActiveGia, null);
  assert.equal(evidence.totalActiveGia, null);
});

test("duplicates and oversized source identities remain explicit without colliding", () => {
  const oversized = "plot-" + "x".repeat(160);
  const evidence = buildCvrGiaSnapshotEvidence({ plotMaster: { plots: [
    { id: "duplicate", plotNumber: "1", gia: 100 },
    { id: "duplicate", plotNumber: "2", gia: 200 },
    { plotNumber: "3", gia: 300 },
    { plotNumber: "3", gia: 400 },
    { id: oversized, plotNumber: "5", gia: 500 },
  ] } });
  assert.equal(new Set(evidence.plots.map((row) => row.plotId)).size, 5);
  assert.deepEqual(evidence.plots.slice(0, 4).map((row) => row.sourceIdentityDuplicate), [true, true, true, true]);
  assert.equal(evidence.plots[4].sourceIdentityOversized, true);
  assert.equal(evidence.plots[4].sourcePlotId, oversized);
});

test("missing Plot Master and no-active-plot evidence remain explicitly unavailable", () => {
  const missing = buildCvrGiaSnapshotEvidence({});
  assert.equal(missing.availabilityState, "plot_master_missing");
  assert.equal(missing.totalActiveGia, null);
  const inactive = buildCvrGiaSnapshotEvidence({ plotMaster: { plots: [{ id: "p1", status: "inactive", gia: 500 }] } });
  assert.equal(inactive.availabilityState, "no_active_plots");
  assert.equal(inactive.totalActiveGia, null);
});

test("historical snapshots without frozen GIA expose an explicit legacy-unavailable state", () => {
  const snapshot = snapshotHeaderToDocument({
    id: "snapshot-legacy", client_id: "client", development_id: "development",
    period_id: "period", period_key: "P01", schema_version: 3,
    commentary: {}, source_readiness: {}, created_at: new Date("2026-01-01T00:00:00Z"),
  });
  assert.equal(snapshot.giaEvidence.captured, false);
  assert.equal(snapshot.giaEvidence.availabilityState, "legacy_unavailable");
  assert.equal(snapshot.giaEvidence.totalActiveGia, null);
});
