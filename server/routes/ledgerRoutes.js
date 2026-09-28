/**
 * BL-031A — Purchase ledger API (/api/developments/:developmentId/ledger/...).
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { requirePermission } = require("../auth/authorization");
const { PERMISSIONS } = require("../auth/permissions");
const {
  getLedgerTotals,
  importLedgerBatch,
  listLedgerBatches,
  listLedgerTransactions,
  resolveLedgerTransaction,
  reverseLedgerTransaction,
} = require("../services/ledgerRepository");

const router = express.Router({ mergeParams: true });

function sendResult(res, result, payloadKey) {
  if (!result.ok) {
    const payload = { message: result.message };
    if (result.duplicates) payload.duplicates = result.duplicates;
    if (result.transaction) payload.transaction = result.transaction;
    return res.status(result.status || 400).json(payload);
  }
  if (payloadKey === "import") {
    return res.status(result.status || 201).json({
      batch: result.batch,
      transactions: result.transactions,
    });
  }
  return res.status(result.status || 200).json(result[payloadKey]);
}

router.get("/ledger/batches", requirePermission(PERMISSIONS.COMMERCIAL_READ), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const result = await listLedgerBatches(req.buildliteAuth.clientId, req.params.developmentId);
    if (!result.ok) return sendResult(res, result);
    res.json({ batches: result.batches });
  } catch (err) {
    console.error("[Ledger] list batches error:", err);
    res.status(500).json({ message: "Failed to list ledger import batches." });
  }
});

router.get("/ledger/transactions", requirePermission(PERMISSIONS.COMMERCIAL_READ), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const result = await listLedgerTransactions(req.buildliteAuth.clientId, req.params.developmentId);
    if (!result.ok) return sendResult(res, result);
    res.json({ transactions: result.transactions });
  } catch (err) {
    console.error("[Ledger] list transactions error:", err);
    res.status(500).json({ message: "Failed to list ledger transactions." });
  }
});

router.get("/ledger/totals", requirePermission(PERMISSIONS.COMMERCIAL_READ), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const result = await getLedgerTotals(req.buildliteAuth.clientId, req.params.developmentId);
    if (!result.ok) return sendResult(res, result);
    res.json(result.totals);
  } catch (err) {
    console.error("[Ledger] totals error:", err);
    res.status(500).json({ message: "Failed to load ledger totals." });
  }
});

router.post("/ledger/batches", requirePermission(PERMISSIONS.LEDGER_MANAGE), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const body = req.body || {};
    const result = await importLedgerBatch(req.buildliteAuth.clientId, req.params.developmentId, body, req.buildliteAuth);
    sendResult(res, result, "import");
  } catch (err) {
    console.error("[Ledger] import batch error:", err);
    res.status(500).json({ message: "Failed to import ledger batch." });
  }
});

router.post("/ledger/transactions/:transactionId/reverse", requirePermission(PERMISSIONS.LEDGER_MANAGE), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const body = req.body || {};
    const result = await reverseLedgerTransaction(
      req.buildliteAuth.clientId,
      req.params.developmentId,
      req.params.transactionId,
      body,
      req.buildliteAuth
    );
    sendResult(res, result, "transaction");
  } catch (err) {
    console.error("[Ledger] reverse transaction error:", err);
    res.status(500).json({ message: "Failed to reverse ledger transaction." });
  }
});

router.post("/ledger/transactions/:transactionId/resolve", requirePermission(PERMISSIONS.LEDGER_MANAGE), async (req,res) => {
  try {
    const result = await resolveLedgerTransaction(req.buildliteAuth.clientId, req.params.developmentId, req.params.transactionId, req.body || {}, req.buildliteAuth);
    sendResult(res, result, "transaction");
  } catch (err) {
    console.error("[Ledger] resolve transaction error:", err);
    res.status(500).json({message:"Failed to resolve ledger transaction."});
  }
});

module.exports = router;
