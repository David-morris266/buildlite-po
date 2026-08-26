/**
 * BL-031E.2 — Server CVR close calculation engine.
 *
 * Reconstructs the complete BL-031D commercial position for one
 * client/development/period from Postgres. Returns a candidate snapshot
 * model only. Does not persist. Approve & Lock (BL-031E.3B) persists the
 * candidate inside the same transaction when `dbClient` is supplied.
 */

const { buildSubcontractOrderKey } = require("./packageKey");
const {
  CVR_SNAPSHOT_SCHEMA_VERSION,
  PACKAGE_VALUE_STATUSES,
  RECOVERY_RELATIONSHIP_TYPE,
} = require("./cvrCloseConstants");
const {
  buildCostCodeLabel,
  buildCvrTotals,
  enrichCvrForecastRow,
  getApprovedCertificateValue,
  normaliseCostCodeKey,
  roundMoney,
} = require("./cvrCloseFormulas");
const {
  getPoCommittedNet,
  getPoCostCode,
  getPoNumber,
  isApprovedPo,
  loadCvrCloseSources,
  sourceReadinessDocument,
} = require("./cvrCloseSources");
const { isApprovedSubcontractPo } = require("./packagePoExtract");
const { effectiveExpectedLiability } = require("./commercialEventExpectedLiability");

function isRecoveryCommercialEvent(event) {
  return event?.relationshipType === RECOVERY_RELATIONSHIP_TYPE;
}

function isApprovedContractValueEvent(event) {
  return (
    PACKAGE_VALUE_STATUSES.has(event?.status) && !isRecoveryCommercialEvent(event)
  );
}

function eventsForOrder(events, orderKey) {
  return (events || []).filter(
    (event) => event.orderKey === orderKey || event.packageId === orderKey
  );
}

function approvedContractValueMovement(events) {
  return (events || []).reduce((total, event) => {
    if (!isApprovedContractValueEvent(event)) return total;
    const value = Number(event.value);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function notReadyResult({ clientId, developmentId, periodId, sources, blockers }) {
  return {
    ready: false,
    complete: false,
    canLock: false,
    clientId,
    developmentId,
    periodId,
    blockers,
    sourceReadiness: sourceReadinessDocument(sources),
    snapshot: null,
  };
}

function collectSourceBlockers(sources) {
  const blockers = [];
  for (const [source, state] of Object.entries(sources || {})) {
    if (!state?.loaded || !state?.ready) {
      blockers.push({
        source,
        reason: state?.reason || "source-unavailable",
        error: state?.error || null,
      });
    }
  }
  return blockers;
}

function buildSubcontractOrders(pos, developmentId) {
  const groups = new Map();

  for (const po of pos || []) {
    if (!isApprovedSubcontractPo(po)) continue;
    const supplierId = po.supplierId ? String(po.supplierId) : "";
    if (!supplierId) continue;

    const costCode = getPoCostCode(po);
    const orderKey = buildSubcontractOrderKey(developmentId, supplierId, costCode);
    const existing = groups.get(orderKey) || {
      orderKey,
      developmentId: String(developmentId),
      supplierId,
      costCode,
      committedValue: 0,
      poNumbers: [],
    };

    existing.committedValue += getPoCommittedNet(po);
    const poNumber = getPoNumber(po);
    if (poNumber && !existing.poNumbers.includes(poNumber)) {
      existing.poNumbers.push(poNumber);
    }
    groups.set(orderKey, existing);
  }

  return [...groups.values()];
}

function addAmount(map, key, amount) {
  map.set(key, (map.get(key) || 0) + amount);
}

function buildCommitmentsByCostCode(developmentId, pos, events) {
  const totals = new Map();
  const labels = new Map();

  for (const order of buildSubcontractOrders(pos, developmentId)) {
    const key = normaliseCostCodeKey(order.costCode);
    if (!key) continue;
    const movement = approvedContractValueMovement(
      eventsForOrder(events, order.orderKey)
    );
    const amount = Number(order.committedValue) + movement;
    addAmount(totals, key, Number.isFinite(amount) ? amount : 0);
    if (!labels.has(key)) {
      labels.set(key, buildCostCodeLabel(key, order.costCode));
    }
  }

  for (const po of pos || []) {
    if (!isApprovedPo(po) || isApprovedSubcontractPo(po)) continue;
    const costCode = getPoCostCode(po);
    const key = normaliseCostCodeKey(costCode);
    if (!key) continue;
    addAmount(totals, key, getPoCommittedNet(po));
    if (!labels.has(key)) {
      labels.set(key, buildCostCodeLabel(key, costCode));
    }
  }

  return { totals, labels };
}

function buildCertifiedByCostCode(developmentId, pos, certificates) {
  const totals = new Map();
  const labels = new Map();
  const hasPackage = new Set();
  const incomplete = [];

  const certsByOrder = new Map();
  for (const certificate of certificates || []) {
    const orderKey = certificate.orderKey;
    if (!orderKey) continue;
    const list = certsByOrder.get(orderKey) || [];
    list.push(certificate);
    certsByOrder.set(orderKey, list);
  }

  for (const order of buildSubcontractOrders(pos, developmentId)) {
    const key = normaliseCostCodeKey(order.costCode);
    if (!key) continue;
    hasPackage.add(key);
    if (!labels.has(key)) {
      labels.set(key, buildCostCodeLabel(key, order.costCode));
    }

    const packageCerts = certsByOrder.get(order.orderKey) || [];
    let packageTotal = 0;
    for (const certificate of packageCerts) {
      if (!certificate.status || ["draft", "submitted"].includes(certificate.status)) {
        continue;
      }
      const value = getApprovedCertificateValue(certificate);
      if (value == null) {
        incomplete.push({
          source: "certificates",
          reason: "approved-certificate-gross-unresolved",
          certificateId: certificate.id || null,
          orderKey: order.orderKey,
          costCodeKey: key,
        });
        continue;
      }
      packageTotal += value;
    }
    addAmount(totals, key, roundMoney(packageTotal) ?? 0);
  }

  return { totals, labels, hasPackage, incomplete };
}

function buildActualsByCostCode(transactions) {
  const totals = new Map();
  const labels = new Map();

  for (const txn of transactions || []) {
    const key = normaliseCostCodeKey(txn.costCodeKey || txn.costCode);
    if (!key) continue;
    addAmount(totals, key, Number(txn.netAmount) || 0);
    if (!labels.has(key)) {
      labels.set(key, buildCostCodeLabel(key, txn.costCodeKey || txn.costCode));
    }
  }

  return { totals, labels };
}

function buildExpectedLiabilityByCostCode(events) {
  const totals = new Map();
  const labels = new Map();
  for (const event of events || []) {
    const amount = effectiveExpectedLiability(event);
    if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) continue;
    const costCode = event.costCode || event.costCodeKey;
    const key = normaliseCostCodeKey(costCode);
    if (!key) continue;
    addAmount(totals, key, amount);
    if (!labels.has(key)) labels.set(key, buildCostCodeLabel(key, costCode));
  }
  return { totals, labels };
}

function collectCostCodeKeys(sources, inputs) {
  const keys = new Set();
  for (const source of sources) {
    for (const key of source.totals.keys()) keys.add(key);
    if (source.hasPackage) {
      for (const key of source.hasPackage) keys.add(key);
    }
  }
  for (const input of inputs || []) {
    const key = normaliseCostCodeKey(input.costCodeKey);
    if (key) keys.add(key);
  }
  return keys;
}

function moneyOrZero(value) {
  return roundMoney(value) ?? 0;
}

function snapshotRowFromEnriched(row) {
  return {
    costCodeKey: row.costCodeKey,
    costCodeLabel: row.costCodeLabel,
    description: row.description || "",
    commercialHead: row.commercialHead || "",
    commercialFamily: row.commercialFamily || "",
    trade: row.trade || "",
    active: row.active !== false,
    originalBudget: row.originalBudget,
    currentBudget: row.currentBudget,
    commercialAdjustment: moneyOrZero(row.commercialAdjustment),
    adjustmentReason: row.adjustmentReason || "",
    manualAccrual: moneyOrZero(row.manualAccrual),
    notes: row.notes || "",
    committed: moneyOrZero(row.committed),
    certified: moneyOrZero(row.certified),
    actualCost: moneyOrZero(row.actualCost),
    currentCost: moneyOrZero(row.currentCost),
    systemForecast: moneyOrZero(row.systemForecast),
    expectedLiability: moneyOrZero(row.expectedLiability),
    finalForecast: moneyOrZero(row.finalForecast),
    costToComplete: moneyOrZero(row.costToComplete),
    outstandingCertified: moneyOrZero(row.outstandingCertified),
    variance: moneyOrZero(row.variance),
    displayMetadata:
      row.displayMetadata && typeof row.displayMetadata === "object"
        ? row.displayMetadata
        : {},
  };
}

async function buildCvrCloseCandidate({
  clientId,
  developmentId,
  periodId,
  actor = null,
  dbClient = null,
  loadSources = loadCvrCloseSources,
} = {}) {
  const loaded = await loadSources({ clientId, developmentId, periodId, dbClient });
  const sources = loaded.sources || {};
  const sourceBlockers = collectSourceBlockers(sources);

  if (!loaded.ok || sourceBlockers.length) {
    return notReadyResult({
      clientId,
      developmentId,
      periodId,
      sources,
      blockers: sourceBlockers.length
        ? sourceBlockers
        : [{ source: "close-sources", reason: "incomplete" }],
    });
  }

  const period = sources.period.value;
  const inputs = sources.inputs.value || [];
  const pos = sources.purchaseOrders.value || [];
  const events = sources.commercialEvents.value || [];
  const certificates = sources.certificates.value || [];
  const transactions = sources.ledger.value || [];

  const commitments = buildCommitmentsByCostCode(developmentId, pos, events);
  const certified = buildCertifiedByCostCode(developmentId, pos, certificates);
  if (certified.incomplete.length) {
    return notReadyResult({
      clientId,
      developmentId,
      periodId,
      sources,
      blockers: certified.incomplete,
    });
  }

  const actuals = buildActualsByCostCode(transactions);
  const expectedLiabilities = buildExpectedLiabilityByCostCode(events);
  const manualByKey = new Map();
  for (const input of inputs) {
    const key = normaliseCostCodeKey(input.costCodeKey);
    if (!key) continue;
    if (!manualByKey.has(key)) {
      manualByKey.set(key, { ...input, costCodeKey: key });
    }
  }

  const allKeys = collectCostCodeKeys(
    [commitments, certified, actuals, expectedLiabilities],
    inputs
  );
  const rows = [...allKeys].map((key) => {
    const manual = manualByKey.get(key);
    const hasManualBudget =
      manual && (manual.originalBudget != null || manual.currentBudget != null);
    const hasInput = Boolean(manual);
    const hasPackage = certified.hasPackage.has(key);

    const label =
      manual?.costCodeLabel ||
      commitments.labels.get(key) ||
      certified.labels.get(key) ||
      actuals.labels.get(key) ||
      expectedLiabilities.labels.get(key) ||
      buildCostCodeLabel(key);

    const committed = commitments.totals.has(key)
      ? commitments.totals.get(key)
      : hasManualBudget || hasInput
        ? 0
        : 0;
    const certifiedValue = hasPackage
      ? certified.totals.get(key) ?? 0
      : hasManualBudget || hasInput
        ? 0
        : 0;
    const actualCost = actuals.totals.has(key) ? actuals.totals.get(key) : 0;

    return enrichCvrForecastRow({
      costCodeKey: manual?.costCodeKey || key,
      costCodeLabel: label,
      description: manual?.description || "",
      commercialHead: manual?.commercialHead || "",
      commercialFamily: manual?.commercialFamily || "",
      trade: manual?.trade || "",
      active: manual?.active !== false,
      originalBudget: manual?.originalBudget ?? null,
      currentBudget: manual?.currentBudget ?? null,
      commercialAdjustment: manual?.commercialAdjustment ?? 0,
      adjustmentReason: manual?.adjustmentReason || "",
      notes: manual?.notes || "",
      displayMetadata: manual?.displayMetadata || {},
      committed: roundMoney(committed) ?? 0,
      certified: roundMoney(certifiedValue) ?? 0,
      actualCost: roundMoney(actualCost) ?? 0,
      expectedLiability: roundMoney(expectedLiabilities.totals.get(key)) ?? 0,
      manualAccrual: manual?.manualAccrual ?? 0,
    });
  });

  rows.sort((a, b) =>
    String(a.costCodeLabel).localeCompare(String(b.costCodeLabel), undefined, {
      sensitivity: "base",
    })
  );

  const snapshotRows = rows.map(snapshotRowFromEnriched);
  const totals = buildCvrTotals(snapshotRows);
  const sourceReadiness = sourceReadinessDocument(sources);

  return {
    ready: true,
    complete: true,
    canLock: true,
    clientId,
    developmentId,
    periodId,
    blockers: [],
    sourceReadiness,
    snapshot: {
      clientId,
      developmentId,
      periodId,
      periodKey: period.periodKey,
      schemaVersion: CVR_SNAPSHOT_SCHEMA_VERSION,
      commentary: period.commentary || {},
      sourceReadiness,
      ...totals,
      rows: snapshotRows,
      createdAt: null,
      createdBy: actor || null,
    },
  };
}

module.exports = {
  buildCvrCloseCandidate,
  buildCommitmentsByCostCode,
  buildCertifiedByCostCode,
  buildActualsByCostCode,
  buildExpectedLiabilityByCostCode,
  buildSubcontractOrders,
  isRecoveryCommercialEvent,
  isApprovedContractValueEvent,
};
