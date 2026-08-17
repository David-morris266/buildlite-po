/**
 * BL-030A — Stable plot/stage identity for V1 certificates.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCellId,
  indexMatrixCells,
  looksLikePositionalCellKey,
  normalizePlotKey,
  normalizeStageKey,
  parseCellId,
} = require("../services/paymentCertificateCellIdentity");

test("plot key is the durable plot id", () => {
  assert.equal(normalizePlotKey("  plot-1  "), "plot-1");
});

test("stage key is NFC-normalised trimmed label", () => {
  const decomposed = "First Fix".normalize("NFD");
  assert.equal(normalizeStageKey(`  ${decomposed}  `), "First Fix");
});

test("cellId encodes plot and stage without using array indexes", () => {
  const cellId = buildCellId("P1", "First Fix");
  assert.equal(cellId, "P1::First%20Fix");
  assert.deepEqual(parseCellId(cellId), { plotKey: "P1", stageKey: "First Fix" });
  assert.equal(looksLikePositionalCellKey(cellId), false);
});

test("positional browser keys are detected and are not valid stage identity", () => {
  assert.equal(looksLikePositionalCellKey("0::1"), true);
  assert.equal(looksLikePositionalCellKey("12::3"), true);
  assert.equal(looksLikePositionalCellKey("P1::First Fix"), false);
});

test("indexMatrixCells uses plot.id and stage label, not array position", () => {
  const indexed = indexMatrixCells({
    layout: "plot-stage",
    stages: ["Second", "First"],
    plots: [
      { id: "plot-b", label: "Plot B", houseType: "Detached", values: [20, 10] },
      { id: "plot-a", label: "Plot A", values: [40, 30] },
    ],
  });
  assert.equal(indexed.ok, true);
  const firstA = indexed.cells.find(
    (cell) => cell.plotKey === "plot-a" && cell.stageKey === "First"
  );
  assert.ok(firstA);
  assert.equal(firstA.contractValue, 30);
  assert.equal(firstA.plotLabel, "Plot A");
  assert.equal(firstA.cellId, buildCellId("plot-a", "First"));
  const secondB = indexed.cells.find(
    (cell) => cell.plotKey === "plot-b" && cell.stageKey === "Second"
  );
  assert.equal(secondB.contractValue, 20);
  assert.equal(secondB.houseType, "Detached");
});

test("duplicate plot ids are rejected", () => {
  const indexed = indexMatrixCells({
    layout: "plot-stage",
    stages: ["A"],
    plots: [
      { id: "plot-1", label: "1", values: [1] },
      { id: "plot-1", label: "2", values: [2] },
    ],
  });
  assert.equal(indexed.ok, false);
  assert.match(indexed.errors[0], /Duplicate plot identity/);
});

test("duplicate stage labels are rejected", () => {
  const indexed = indexMatrixCells({
    layout: "plot-stage",
    stages: ["First Fix", "First Fix"],
    plots: [{ id: "plot-1", label: "1", values: [1, 2] }],
  });
  assert.equal(indexed.ok, false);
  assert.match(indexed.errors[0], /Duplicate stage identity/);
});
