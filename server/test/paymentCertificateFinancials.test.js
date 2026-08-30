/**
 * BL-030A — Works-totals parity with client-known answers.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCertificateWorksTotals,
  calculateRetentionMovement,
  cumulativeRetentionPosition,
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

test("a valid zero-value Draft valuation remains eligible for submission snapshotting", () => {
  const live = buildLiveValuation({
    matrix: {
      id: "mx-zero",
      version: 1,
      layout: "plot-stage",
      stages: ["Works"],
      plots: [{ id: "plot-1", label: "Plot 1", values: [10000] }],
    },
    progress: {},
    commercialLines: [],
    lockedCertificates: [],
    pos: [{ subtotal: 10000, vatRateDefault: 0.2, retentionRateDefault: 0.05 }],
  });

  assert.equal(live.ok, true);
  assert.equal(live.totals.grossWorksThisCertificate, 0);
  assert.equal(live.totals.retention, 0);
  assert.equal(live.totals.vat, 0);
  assert.equal(live.totals.netPayment, 0);
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

test("cumulative retention releases only the balance justified by negative credits", () => {
  const first = buildCertificateWorksTotals(matrixCells(0), {
    commercialLines: [{ lineType: "valueInclusion", amountThisCertificate: -1500 }],
    previousGross: 36000, previousRetentionHeld: 1800, priorRates: [0.05],
    vatRate: 0.2, retentionRate: 0.05,
  });
  assert.equal(first.retention, -75);
  assert.equal(first.cumulativeRetentionHeld, 1725);
  assert.equal(first.vat, -285);
  assert.equal(first.netPayment, -1710);
  const second = buildCertificateWorksTotals(matrixCells(0), {
    commercialLines: [{ lineType: "valueInclusion", amountThisCertificate: -1500 }],
    previousGross: 34500, previousRetentionHeld: 1725, priorRates: [0.05, 0.05],
    vatRate: 0.2, retentionRate: 0.05,
  });
  assert.equal(second.retention, -75);
  assert.equal(second.cumulativeRetentionHeld, 1650);
});

test("cumulative retention handles positive work and a credit back to zero", () => {
  const positive = calculateRetentionMovement({ currentGross: 10000, retentionRate: 0.05, previousGross: 20000, previousRetentionHeld: 1000, priorRates: [0.05] });
  assert.equal(positive.retention, 500);
  assert.equal(positive.cumulativeRetentionHeld, 1500);
  const toZero = calculateRetentionMovement({ currentGross: -1000, retentionRate: 0.05, previousGross: 1000, previousRetentionHeld: 50, priorRates: [0.05] });
  assert.equal(toZero.retention, -50);
  assert.equal(toZero.cumulativeRetentionHeld, 0);
});

test("cumulative retention rejects negative gross and cannot release more than held", () => {
  const belowZero = calculateRetentionMovement({ currentGross: -1000.01, retentionRate: 0.05, previousGross: 1000, previousRetentionHeld: 50, priorRates: [0.05] });
  assert.equal(belowZero.ok, false);
  assert.match(belowZero.errors[0], /below £0/);
  const defensive = calculateRetentionMovement({ currentGross: -1000, retentionRate: 0.05, previousGross: 1000, previousRetentionHeld: 20, priorRates: [0.05] });
  assert.equal(defensive.retention, -20);
  assert.equal(defensive.cumulativeRetentionHeld, 0);
});

test("zero-rated negative credit releases retention without VAT", () => {
  const totals = buildCertificateWorksTotals(matrixCells(0), {
    commercialLines: [{ lineType: "valueInclusion", amountThisCertificate: -1500 }],
    previousGross: 36000, previousRetentionHeld: 1800, priorRates: [0.05],
    vatRate: 0, retentionRate: 0.05,
  });
  assert.equal(totals.retention, -75);
  assert.equal(totals.vat, 0);
  assert.equal(totals.netPayment, -1425);
});

test("draft and rejected certificates do not form cumulative retention history", () => {
  const position = cumulativeRetentionPosition([
    { status: "locked", grossValue: 36000, retention: 1800, retentionRate: 0.05 },
    { status: "draft", grossValue: -1500, retention: -75, retentionRate: 0.05 },
    { status: "rejected", grossValue: -1500, retention: -75, retentionRate: 0.05 },
  ]);
  assert.deepEqual(position, {
    previousGross: 36000,
    previousRetentionHeld: 1800,
    priorRates: [0.05],
  });
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

test("live Draft valuation rejects a credit that takes locked cumulative gross below zero", () => {
  const live = buildLiveValuation({
    matrix: {
      id: "mx-credit",
      version: 1,
      layout: "plot-stage",
      stages: ["Works"],
      plots: [{ id: "plot-1", label: "Plot 1", values: [1000] }],
    },
    progress: {},
    commercialLines: [{ lineType: "valueInclusion", amountThisCertificate: -1000.01 }],
    lockedCertificates: [{
      status: "locked",
      certificateNumber: 1,
      grossValue: 1000,
      retention: 50,
      retentionRate: 0.05,
    }],
    pos: [{ subtotal: 100000, vatRateDefault: 0.2, retentionRateDefault: 0.05 }],
  });
  assert.equal(live.ok, false);
  assert.match(live.errors[0], /below £0/);
});
