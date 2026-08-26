const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSubcontractOrderKey } = require("../services/packageKey");
const { buildCvrCloseCandidate } = require("../services/cvrCloseEngine");
const { sourceOk } = require("../services/cvrCloseSources");

const CLIENT_ID = "tenant-bl038c";
const DEVELOPMENT_ID = "dev-bl038c";
const PERIOD_ID = "period-bl038c";
const ORDER_KEY = buildSubcontractOrderKey(DEVELOPMENT_ID, "supplier-1", "5218");

function po(value = 10000) {
  return {
    poNumber: "S-BL038C",
    type: "S",
    supplierId: "supplier-1",
    developmentId: DEVELOPMENT_ID,
    costRef: { developmentId: DEVELOPMENT_ID, costCode: "5218" },
    subtotal: value,
    totals: { net: value },
    approval: { status: "approved" },
    status: "approved",
  };
}

function event(overrides = {}) {
  return {
    id: `ce-${Math.random().toString(36).slice(2)}`,
    developmentId: DEVELOPMENT_ID,
    packageId: ORDER_KEY,
    orderKey: ORDER_KEY,
    costCode: "5218",
    eventType: "variation",
    relationshipType: "origin",
    financialTreatment: "contractAmendment",
    status: "submitted",
    value: 20000,
    expectedTreatment: "default",
    expectedAmount: null,
    ...overrides,
  };
}

function loadSources({ events = [], inputs = [], pos = [po()] } = {}) {
  return async ({ clientId, developmentId, periodId }) => {
    assert.equal(clientId, CLIENT_ID);
    assert.equal(developmentId, DEVELOPMENT_ID);
    assert.equal(periodId, PERIOD_ID);
    return {
      ok: true,
      sources: {
        development: sourceOk({ id: DEVELOPMENT_ID }),
        period: sourceOk({ id: PERIOD_ID, periodKey: "P01", commentary: {} }),
        inputs: sourceOk(inputs),
        purchaseOrders: sourceOk(pos),
        commercialEvents: sourceOk(events),
        certificates: sourceOk([]),
        ledger: sourceOk([]),
      },
    };
  };
}

async function close(options = {}) {
  return buildCvrCloseCandidate({
    clientId: CLIENT_ID,
    developmentId: DEVELOPMENT_ID,
    periodId: PERIOD_ID,
    loadSources: loadSources(options),
  });
}

function row(result, key = "5218") {
  return result.snapshot.rows.find((item) => item.costCodeKey === key);
}

test("BL-038C submitted default is additive to Final only", async () => {
  const result = await close({ events: [event()] });
  assert.deepEqual(
    {
      committed: row(result).committed,
      system: row(result).systemForecast,
      expected: row(result).expectedLiability,
      final: row(result).finalForecast,
      certified: row(result).certified,
      actual: row(result).actualCost,
      accrual: row(result).manualAccrual,
    },
    { committed: 10000, system: 10000, expected: 20000, final: 30000, certified: 0, actual: 0, accrual: 0 }
  );
});

test("BL-038C override, above-submitted, hold and exclude treatments", async () => {
  for (const [expectedTreatment, expectedAmount, expected] of [
    ["override", 15000, 15000],
    ["override", 25000, 25000],
    ["hold", null, 0],
    ["exclude", null, 0],
  ]) {
    const result = await close({
      events: [event({ expectedTreatment, expectedAmount })],
    });
    assert.equal(row(result).expectedLiability, expected);
    assert.equal(row(result).systemForecast, 10000);
    assert.equal(row(result).finalForecast, 10000 + expected);
  }
});

test("BL-038C approval transfers liability into commitment without double count", async () => {
  const submitted = await close({ events: [event()] });
  const approved = await close({ events: [event({ status: "approved" })] });
  assert.equal(row(submitted).systemForecast, 10000);
  assert.equal(row(submitted).expectedLiability, 20000);
  assert.equal(row(submitted).finalForecast, 30000);
  assert.equal(row(approved).committed, 30000);
  assert.equal(row(approved).systemForecast, 30000);
  assert.equal(row(approved).expectedLiability, 0);
  assert.equal(row(approved).finalForecast, 30000);
});

test("BL-038C rejected and non-contract-value events contribute zero", async () => {
  for (const excluded of [
    event({ status: "rejected" }),
    event({ relationshipType: "recovery" }),
    event({ financialTreatment: "recoverableDeduction" }),
    event({ status: "includedInCertificate" }),
    event({ status: "closed" }),
  ]) {
    const result = await close({ events: [excluded] });
    assert.equal(row(result).expectedLiability, 0);
  }
});

test("BL-038C aggregates submitted CEs and generic adjustment additively", async () => {
  const result = await close({
    events: [event({ value: 12000 }), event({ value: 8000 })],
    inputs: [{
      costCodeKey: "5218",
      costCodeLabel: "5218 — Site Works",
      commercialAdjustment: 5000,
      manualAccrual: 400,
    }],
  });
  assert.equal(row(result).expectedLiability, 20000);
  assert.equal(row(result).commercialAdjustment, 5000);
  assert.equal(row(result).finalForecast, 35000);
  assert.equal(row(result).manualAccrual, 400);
  assert.equal(row(result).currentCost, 400);
  assert.equal(row(result).costToComplete, 34600);
});

test("BL-038C Expected creates a fact-only row without overlay membership", async () => {
  const result = await close({
    pos: [],
    inputs: [],
    events: [event({ costCode: "7777", packageId: "fact-only", orderKey: "fact-only" })],
  });
  const factOnly = row(result, "7777");
  assert.ok(factOnly);
  assert.equal(factOnly.systemForecast, 0);
  assert.equal(factOnly.expectedLiability, 20000);
  assert.equal(factOnly.finalForecast, 20000);
});

test("BL-038C engine/adoption replacement adjustment is not reduced by Expected", async () => {
  const result = await close({
    events: [event()],
    inputs: [{
      costCodeKey: "5218",
      costCodeLabel: "5218 — Site Works",
      commercialAdjustment: 2000,
      displayMetadata: { sellingCostsAdoption: { adoptedTargetFinal: 12000 } },
    }],
  });
  assert.equal(row(result).systemForecast, 10000);
  assert.equal(row(result).expectedLiability, 20000);
  assert.equal(row(result).commercialAdjustment, 2000);
  assert.equal(row(result).finalForecast, 32000);
});

test("BL-038C candidate remains calculation-only with no lifecycle or snapshot write", async () => {
  const result = await close({ events: [event()] });
  assert.equal(result.snapshot.periodId, PERIOD_ID);
  assert.equal(result.snapshot.periodKey, "P01");
  assert.equal(result.snapshot.createdAt, null);
  assert.equal(result.snapshot.expectedLiability, 20000);
});
