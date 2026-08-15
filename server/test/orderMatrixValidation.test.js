/**
 * BL-029A — Plot-stage Order Matrix validation (no database).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validatePlotStageMatrix,
  utf8ByteLength,
} = require("../services/orderMatrixValidation");
const {
  MAX_PAYLOAD_BYTES,
  MAX_LABEL_LENGTH,
  isValidPackageUuid,
} = require("../services/orderMatrixConstants");

function validMatrix(overrides = {}) {
  return {
    layout: "plot-stage",
    committedValue: 1500,
    stages: ["Foundations", "Superstructure"],
    plots: [
      { id: "plot-1", label: "Plot 1", values: [500, 1000] },
    ],
    jobId: "job-1",
    supplierId: "sup-1",
    projectLabel: "Test Site",
    supplierLabel: "Sparktastic",
    ...overrides,
  };
}

test("isValidPackageUuid accepts canonical UUIDs and rejects malformed strings", () => {
  assert.equal(isValidPackageUuid("00000000-0000-4000-8000-000000000099"), true);
  assert.equal(isValidPackageUuid("not-a-uuid"), false);
  assert.equal(isValidPackageUuid("by-order-key"), false);
  assert.equal(isValidPackageUuid(""), false);
});

test("valid plot-stage matrix is accepted", () => {
  const result = validatePlotStageMatrix(validMatrix());
  assert.equal(result.ok, true);
  assert.equal(result.normalized.layout, "plot-stage");
  assert.equal(result.normalized.committedValue, 1500);
  assert.deepEqual(result.normalized.payload.stages, ["Foundations", "Superstructure"]);
  assert.deepEqual(result.normalized.payload.plots, [
    { id: "plot-1", label: "Plot 1", values: [500, 1000] },
  ]);
});

test("malformed layout is rejected", () => {
  const result = validatePlotStageMatrix(validMatrix({ layout: "rows" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /layout must be "plot-stage"/.test(error)));
});

test("malformed stages are rejected", () => {
  const missing = validatePlotStageMatrix(validMatrix({ stages: "Foundations" }));
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => /stages must be an array/.test(error)));

  const blank = validatePlotStageMatrix(validMatrix({ stages: ["  "] }));
  assert.equal(blank.ok, false);
  assert.ok(blank.errors.some((error) => /stages\[0\] must not be blank/.test(error)));

  const empty = validatePlotStageMatrix(validMatrix({ stages: [] }));
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.some((error) => /at least one payment stage/.test(error)));
});

test("malformed plots are rejected", () => {
  const missing = validatePlotStageMatrix(validMatrix({ plots: null }));
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => /plots must be an array/.test(error)));

  const noId = validatePlotStageMatrix(
    validMatrix({ plots: [{ label: "Plot 1", values: [500, 1000] }] })
  );
  assert.equal(noId.ok, false);
  assert.ok(noId.errors.some((error) => /plots\[0\]\.id is required/.test(error)));
});

test("invalid and non-finite values are rejected", () => {
  const nan = validatePlotStageMatrix(
    validMatrix({ plots: [{ id: "p1", label: "P1", values: ["NaN", 1] }] })
  );
  assert.equal(nan.ok, false);
  assert.ok(nan.errors.some((error) => /plots\[0\]\.values\[0\] must be a finite number/.test(error)));

  const inf = validatePlotStageMatrix(
    validMatrix({ plots: [{ id: "p1", label: "P1", values: ["Infinity", 1] }] })
  );
  assert.equal(inf.ok, false);

  const nested = validatePlotStageMatrix(
    validMatrix({ plots: [{ id: "p1", label: "P1", values: [{ n: 1 }, 1] }] })
  );
  assert.equal(nested.ok, false);
});

test("values length must match stage count", () => {
  const result = validatePlotStageMatrix(
    validMatrix({
      stages: ["A", "B", "C"],
      plots: [{ id: "p1", label: "P1", values: [1, 2] }],
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /must match stages length/.test(error)));
});

test("certificate progress, certificates, rows, and xlsx keys are rejected", () => {
  for (const key of ["progress", "certificates", "rows", "xlsx"]) {
    const result = validatePlotStageMatrix(validMatrix({ [key]: { not: "allowed" } }));
    assert.equal(result.ok, false, `${key} should be rejected`);
    assert.ok(result.errors.some((error) => error.includes(`${key} is not allowed`)));
  }
});

test("reasonable payload-size protection rejects oversized matrices", () => {
  const stages = Array.from({ length: 20 }, (_, index) => `Stage ${index + 1}`);
  const plots = Array.from({ length: 500 }, (_, index) => ({
    id: "i".repeat(MAX_LABEL_LENGTH),
    label: "l".repeat(MAX_LABEL_LENGTH),
    values: Array.from({ length: 20 }, () => index),
  }));
  const result = validatePlotStageMatrix(validMatrix({ stages, plots }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /matrix payload exceeds/.test(error)));
  assert.ok(utf8ByteLength(JSON.stringify({ stages, plots })) > MAX_PAYLOAD_BYTES);
});
