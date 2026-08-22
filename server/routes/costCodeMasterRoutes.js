/**
 * BL-033D.x.2A.1 — Tenant Cost Code Master API
 * GET    /api/cost-codes
 * POST   /api/cost-codes
 * GET    /api/cost-codes/:id
 * PUT    /api/cost-codes/:id
 * PUT    /api/cost-codes/:id/active
 *
 * GET never writes. No DELETE. GET /api/po/cost-codes remains the compatibility view.
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const {
  createCostCode,
  getCostCode,
  listCostCodes,
  provisionalActor,
  setCostCodeActive,
  updateCostCode,
} = require("../services/costCodeMasterRepository");

const router = express.Router();

function sendResult(res, result, successKey, successStatus = 200) {
  if (!result.ok) {
    const payload = { message: result.message };
    if (result.errors) payload.errors = result.errors;
    if (result.costCode) payload.costCode = result.costCode;
    return res.status(result.status || 400).json(payload);
  }
  if (successKey === "list") {
    return res.status(result.status || successStatus).json({ costCodes: result.costCodes });
  }
  return res.status(result.status || successStatus).json(result[successKey]);
}

async function withActiveClient(req, res) {
  if (!isDbConfigured()) {
    res.status(500).json({ message: "Database not configured" });
    return null;
  }
  const active = await getActiveClient();
  if (!active) {
    res.status(404).json({ error: "No active client set" });
    return null;
  }
  return active;
}

function parseActiveOnly(query = {}) {
  const raw = query.activeOnly ?? query.active_only;
  return raw === true || raw === "true" || raw === "1";
}

router.get("/", async (req, res) => {
  try {
    const active = await withActiveClient(req, res);
    if (!active) return;
    const result = await listCostCodes(active.id, { activeOnly: parseActiveOnly(req.query) });
    sendResult(res, result, "list");
  } catch (err) {
    console.error("[Cost codes] LIST error:", err);
    res.status(500).json({ message: "Failed to load cost codes." });
  }
});

router.post("/", async (req, res) => {
  try {
    const active = await withActiveClient(req, res);
    if (!active) return;
    const body = req.body || {};
    const result = await createCostCode(active.id, body, { actor: provisionalActor(body) });
    sendResult(res, result, "costCode", 201);
  } catch (err) {
    console.error("[Cost codes] CREATE error:", err);
    res.status(500).json({ message: "Failed to create cost code." });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const active = await withActiveClient(req, res);
    if (!active) return;
    const result = await getCostCode(active.id, req.params.id);
    sendResult(res, result, "costCode");
  } catch (err) {
    console.error("[Cost codes] GET error:", err);
    res.status(500).json({ message: "Failed to load cost code." });
  }
});

router.put("/:id/active", async (req, res) => {
  try {
    const active = await withActiveClient(req, res);
    if (!active) return;
    const body = req.body || {};
    const result = await setCostCodeActive(active.id, req.params.id, body, {
      actor: provisionalActor(body),
    });
    sendResult(res, result, "costCode");
  } catch (err) {
    console.error("[Cost codes] ACTIVE error:", err);
    res.status(500).json({ message: "Failed to update cost code active state." });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const active = await withActiveClient(req, res);
    if (!active) return;
    const body = req.body || {};
    const result = await updateCostCode(active.id, req.params.id, body, {
      actor: provisionalActor(body),
    });
    sendResult(res, result, "costCode");
  } catch (err) {
    console.error("[Cost codes] UPDATE error:", err);
    res.status(500).json({ message: "Failed to save cost code." });
  }
});

module.exports = router;
