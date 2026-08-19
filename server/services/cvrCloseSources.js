/**
 * BL-031E.2 — Authoritative Postgres sources for the CVR close engine.
 * Loads period overlays and live commercial facts. Does not persist snapshots.
 * Optional `dbClient` uses the caller's transaction so Approve & Lock (E.3B)
 * calculates from the same connection that will persist the snapshot.
 */

const { query } = require("../db");
const { listCommercialEvents } = require("./commercialEventRepository");
const { getCvrPeriod, listCostCodeInputs } = require("./cvrPeriodRepository");
const { findDevelopmentById } = require("./developmentRepository");
const { listLedgerTransactions } = require("./ledgerRepository");
const { findDevelopmentByJobNumber } = require("./packageRepository");
const {
  getPoCostCode,
  getPoDevelopmentIdFromPayload,
  getPoJobNumber,
  isApprovedSubcontractPo,
} = require("./packagePoExtract");
const { rowToDocument: certificateRowToDocument } = require("./paymentCertificateMapper");
const { CLOSE_SOURCE_KEYS } = require("./cvrCloseConstants");

async function runQuery(dbClient, text, params) {
  if (dbClient) return dbClient.query(text, params);
  return query(text, params);
}

function sourceFailure(reason, extra = {}) {
  return { loaded: false, ready: false, reason, ...extra };
}

function sourceOk(value, extra = {}) {
  return { loaded: true, ready: true, value, ...extra };
}

function isApprovedPo(po) {
  if (!po || po.archived === true) return false;
  const approval = String(po.approval?.status || "").toLowerCase();
  const status = String(po.status || "").toLowerCase();
  return approval === "approved" || status === "approved";
}

function getPoCommittedNet(po) {
  const n = Number(po?.subtotal ?? po?.totals?.net ?? po?.amount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function getPoNumber(po) {
  return po?.poNumber || po?.po_number || null;
}

async function resolvePoDevelopmentId(clientId, po, caches, dbClient = null) {
  const direct = getPoDevelopmentIdFromPayload(po);
  if (direct) {
    if (caches.developments.has(direct)) return caches.developments.get(direct);
    const row = await findDevelopmentById(clientId, direct, dbClient);
    const id = row ? String(row.id || direct) : null;
    caches.developments.set(direct, id);
    return id;
  }

  const jobNumber = getPoJobNumber(po);
  if (!jobNumber) return null;
  if (caches.jobNumbers.has(jobNumber)) return caches.jobNumbers.get(jobNumber);
  const row = await findDevelopmentByJobNumber(clientId, jobNumber, dbClient);
  const id = row ? String(row.id) : null;
  caches.jobNumbers.set(jobNumber, id);
  return id;
}

function emptySourceReadiness() {
  const sources = {};
  for (const key of CLOSE_SOURCE_KEYS) {
    sources[key] = sourceFailure("not-loaded");
  }
  return sources;
}

async function loadPurchaseOrders(clientId, developmentId, dbClient = null) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT po_number, payload
      FROM purchase_orders
      WHERE client_id = $1
    `,
    [clientId]
  );
  const caches = { developments: new Map(), jobNumbers: new Map() };
  const matched = [];
  for (const row of rows) {
    const payload =
      row.payload && typeof row.payload === "object" ? { ...row.payload } : {};
    if (!payload.poNumber && row.po_number) payload.poNumber = row.po_number;
    const resolvedId = await resolvePoDevelopmentId(clientId, payload, caches, dbClient);
    if (resolvedId !== String(developmentId)) continue;
    matched.push(payload);
  }
  return matched;
}

async function loadCertificates(clientId, developmentId, dbClient = null) {
  const { rows } = await runQuery(
    dbClient,
    `
      SELECT *
      FROM package_payment_certificates
      WHERE client_id = $1
        AND development_id = $2
      ORDER BY order_key ASC, certificate_number ASC
    `,
    [clientId, developmentId]
  );
  return rows.map((row) => certificateRowToDocument(row, []));
}

async function loadCvrCloseSources({ clientId, developmentId, periodId, dbClient = null } = {}) {
  const sources = emptySourceReadiness();

  try {
    const development = await findDevelopmentById(clientId, developmentId, dbClient);
    if (!development) {
      sources.development = sourceFailure("development-not-found");
      return { ok: false, sources };
    }
    sources.development = sourceOk(development);
  } catch (err) {
    sources.development = sourceFailure("development-query-failed", {
      error: err.message,
    });
    return { ok: false, sources };
  }

  try {
    const periodResult = await getCvrPeriod(clientId, developmentId, periodId, dbClient);
    if (!periodResult?.ok || !periodResult.period) {
      sources.period = sourceFailure(
        periodResult?.status === 404 ? "period-not-found" : "period-unavailable",
        { status: periodResult?.status || null, message: periodResult?.message || null }
      );
      return { ok: false, sources };
    }
    sources.period = sourceOk(periodResult.period);
  } catch (err) {
    sources.period = sourceFailure("period-query-failed", { error: err.message });
    return { ok: false, sources };
  }

  try {
    const inputResult = await listCostCodeInputs(clientId, developmentId, periodId, dbClient);
    if (!inputResult?.ok) {
      sources.inputs = sourceFailure("inputs-unavailable", {
        status: inputResult?.status || null,
        message: inputResult?.message || null,
      });
      return { ok: false, sources };
    }
    sources.inputs = sourceOk(inputResult.inputs || []);
  } catch (err) {
    sources.inputs = sourceFailure("inputs-query-failed", { error: err.message });
    return { ok: false, sources };
  }

  try {
    sources.purchaseOrders = sourceOk(
      await loadPurchaseOrders(clientId, developmentId, dbClient)
    );
  } catch (err) {
    sources.purchaseOrders = sourceFailure("purchase-orders-query-failed", {
      error: err.message,
    });
    return { ok: false, sources };
  }

  try {
    sources.commercialEvents = sourceOk(
      await listCommercialEvents(clientId, { developmentId }, dbClient)
    );
  } catch (err) {
    sources.commercialEvents = sourceFailure("commercial-events-query-failed", {
      error: err.message,
    });
    return { ok: false, sources };
  }

  try {
    sources.certificates = sourceOk(
      await loadCertificates(clientId, developmentId, dbClient)
    );
  } catch (err) {
    sources.certificates = sourceFailure("certificates-query-failed", {
      error: err.message,
    });
    return { ok: false, sources };
  }

  try {
    const ledgerResult = await listLedgerTransactions(clientId, developmentId, dbClient);
    if (!ledgerResult?.ok) {
      sources.ledger = sourceFailure("ledger-unavailable", {
        status: ledgerResult?.status || null,
        message: ledgerResult?.message || null,
      });
      return { ok: false, sources };
    }
    sources.ledger = sourceOk(ledgerResult.transactions || []);
  } catch (err) {
    sources.ledger = sourceFailure("ledger-query-failed", { error: err.message });
    return { ok: false, sources };
  }

  return { ok: true, sources };
}

function sourceReadinessDocument(sources) {
  const document = {};
  for (const key of CLOSE_SOURCE_KEYS) {
    const source = sources[key] || sourceFailure("not-loaded");
    document[key] = {
      loaded: Boolean(source.loaded),
      ready: Boolean(source.ready),
      reason: source.reason || null,
      count: Array.isArray(source.value) ? source.value.length : undefined,
    };
  }
  return document;
}

module.exports = {
  isApprovedPo,
  getPoCommittedNet,
  getPoNumber,
  getPoCostCode,
  loadCvrCloseSources,
  sourceFailure,
  sourceOk,
  sourceReadinessDocument,
  emptySourceReadiness,
};
