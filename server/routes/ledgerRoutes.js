/**
 * BL-031A — Purchase ledger API (/api/developments/:developmentId/ledger/...).
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const {
  getLedgerTotals,
  importLedgerBatch,
  listLedgerBatches,
  listLedgerTransactions,
  provisionalActor,
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

router.get("/ledger/batches", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await listLedgerBatches(active.id, req.params.developmentId);
    if (!result.ok) return sendResult(res, result);
    res.json({ batches: result.batches });
  } catch (err) {
    console.error("[Ledger] list batches error:", err);
    res.status(500).json({ message: "Failed to list ledger import batches." });
  }
});

router.get("/ledger/transactions", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await listLedgerTransactions(active.id, req.params.developmentId);
    if (!result.ok) return sendResult(res, result);
    res.json({ transactions: result.transactions });
  } catch (err) {
    console.error("[Ledger] list transactions error:", err);
    res.status(500).json({ message: "Failed to list ledger transactions." });
  }
});

router.get("/ledger/totals", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await getLedgerTotals(active.id, req.params.developmentId);
    if (!result.ok) return sendResult(res, result);
    res.json(result.totals);
  } catch (err) {
    console.error("[Ledger] totals error:", err);
    res.status(500).json({ message: "Failed to load ledger totals." });
  }
});

router.post("/ledger/batches", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await importLedgerBatch(active.id, req.params.developmentId, body, {
      actor: provisionalActor(body),
    });
    sendResult(res, result, "import");
  } catch (err) {
    console.error("[Ledger] import batch error:", err);
    res.status(500).json({ message: "Failed to import ledger batch." });
  }
});

router.post("/ledger/transactions/:transactionId/reverse", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await reverseLedgerTransaction(
      active.id,
      req.params.developmentId,
      req.params.transactionId,
      body,
      { actor: provisionalActor(body) }
    );
    sendResult(res, result, "transaction");
  } catch (err) {
    console.error("[Ledger] reverse transaction error:", err);
    res.status(500).json({ message: "Failed to reverse ledger transaction." });
  }
});

module.exports = router;
