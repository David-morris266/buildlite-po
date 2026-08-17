/**
 * BL-030A — Works-totals parity with client-known answers.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCertificateWorksTotals,
  buildLiveValuation,
  previousCumulativeForCell,
} = require("../services/paymentCertificateFinancials");
const { buildCellId } = require("../services/paymentCertificateCellIdentity");

function matrixCells(grossThis) {
  return [{ thisCertificateValue: grossThis }];
}

test("matrix-only totals keep matrix gross unchanged", () => {
  const totals = buildCertificateWorksTotals(matrixCells(20000), {
    commercialLines: [],
    vatRate: 0,
    retentionRate: 0.05,
  });
  assert.equal(totals.matrixGrossThisCertificate, 20000);
  assert.equal(totals.commercialEventGrossThisCertificate, 0);
  assert.equal(totals.grossWorksThisCertificate, 20000);
  assert.equal(totals.retention, 1000);
  assert.equal(totals.netPayment, 19000);
});

test("CE +£4k increases gross this certificate by £4k", () => {
  const totals = buildCertificateWorksTotals(matrixCells(20000), {
    commercialLines: [{ lineType: "valueInclusion", amountThisCertificate: 4000 }],
    vatRate: 0,
    retentionRate: 0.05,
  });
  assert.equal(totals.grossWorksThisCertificate, 24000);
  assert.equal(totals.retention, 1200);
  assert.equal(totals.vat, 0);
  assert.equal(totals.netPayment, 22800);
});

test("credit −£2k reduces gross and retention base", () => {
  const totals = buildCertificateWorksTotals(matrixCells(20000), {
    commercialLines: [{ lineType: "valueInclusion", amountThisCertificate: -2000 }],
    vatRate: 0,
    retentionRate: 0.05,
  });
  assert.equal(totals.grossWorksThisCertificate, 18000);
  assert.equal(totals.retention, 900);
});

test("multiple CE lines sum signed values", () => {
  const totals = buildCertificateWorksTotals(matrixCells(10000), {
    commercialLines: [
      { lineType: "valueInclusion", amountThisCertificate: 4000 },
      { lineType: "valueInclusion", amountThisCertificate: -2000 },
    ],
    vatRate: 0,
    retentionRate: 0.05,
  });
  assert.equal(totals.commercialEventGrossThisCertificate, 2000);
  assert.equal(totals.grossWorksThisCertificate, 12000);
});

test("VAT uses combined gross minus retention", () => {
  const totals = buildCertificateWorksTotals(matrixCells(20000), {
    commercialLines: [{ lineType: "valueInclusion", amountThisCertificate: 4000 }],
    vatRate: 0.2,
    retentionRate: 0.05,
  });
  assert.equal(totals.vat, 4560);
  assert.equal(totals.netPayment, 27360);
});

test("recovery deduction is signed and reduces net only", () => {
  const totals = buildCertificateWorksTotals(matrixCells(20000), {
    commercialLines: [
      { lineType: "valueInclusion", amountThisCertificate: 4000 },
      { lineType: "recoveryDeduction", amountThisCertificate: -3000 },
    ],
    vatRate: 0,
    retentionRate: 0.05,
  });
  assert.equal(totals.grossWorksThisCertificate, 24000);
  assert.equal(totals.recoveryDeductionSigned, -3000);
  assert.equal(totals.retention, 1200);
  assert.equal(totals.netPayment, 19800);
});

test("previous cumulative uses snapshot identity after reorder", () => {
  const plotKey = "plot-1";
  const stageKey = "First Fix";
  const locked = [
    {
      certificateNumber: 1,
      valuationSnapshot: {
        cells: [
          {
            plotId: plotKey,
            stageKey,
            thisCertificatePct: 40,
          },
        ],
      },
    },
  ];
  assert.equal(previousCumulativeForCell(locked, plotKey, stageKey), 40);
});

test("live valuation maps progress by plot id + stage key", () => {
  const cellId = buildCellId("plot-1", "First Fix");
  const live = buildLiveValuation({
    matrix: {
      id: "mx-1",
      version: 1,
      layout: "plot-stage",
      stages: ["First Fix"],
      plots: [{ id: "plot-1", label: "Plot 1", values: [10000] }],
    },
    progress: {
      [cellId]: { plotId: "plot-1", stageKey: "First Fix", thisCertificatePct: 40 },
    },
    commercialLines: [],
    lockedCertificates: [],
    pos: [{ subtotal: 100000, vatRateDefault: 0, retentionRateDefault: 0.05 }],
  });
  assert.equal(live.ok, true);
  assert.equal(live.cells[0].thisCertificateValue, 4000);
  assert.equal(live.totals.grossWorksThisCertificate, 4000);
  assert.equal(live.totals.retention, 200);
  assert.equal(live.totals.netPayment, 3800);
});
