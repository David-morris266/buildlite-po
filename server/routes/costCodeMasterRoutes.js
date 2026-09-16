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
const { requirePermission } = require("../auth/authorization");
const { PERMISSIONS } = require("../auth/permissions");
const costCodeImport = require('../services/costCodeImportRepository');
const {
  bulkUpdateCostCodeHierarchy,
  createCostCode,
  getCostCode,
  getCostCodeOnboardingSummary,
  listCostCodes,
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
  const clientId = req.buildliteAuth?.clientId;
  if (!clientId) {
    res.status(401).json({ message: "Authentication required" });
    return null;
  }
  return { id: clientId };
}

function parseActiveOnly(query = {}) {
  const raw = query.activeOnly ?? query.active_only;
  return raw === true || raw === "true" || raw === "1";
}

router.get("/", requirePermission(PERMISSIONS.COMMERCIAL_READ), async (req, res) => {
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

router.post('/import/preview',requirePermission(PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE),async(req,res)=>{try{const client=await withActiveClient(req,res);if(!client)return;const result=await costCodeImport.preview(client.id,req.body||{},req.buildliteAuth);if(!result.ok)return res.status(result.status||400).json({message:result.message,errors:result.errors});return res.status(result.status||200).json({preview:result.preview});}catch(error){res.status(error.status||500).json({message:error.message||'Failed to preview Cost Code import.'});}});
router.post('/import/apply',requirePermission(PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE),async(req,res)=>{try{const client=await withActiveClient(req,res);if(!client)return;const result=await costCodeImport.apply(client.id,req.body||{},req.buildliteAuth);if(!result.ok)return res.status(result.status||400).json({message:result.message,errors:result.errors});return res.status(result.status||200).json({summary:result.summary});}catch(error){res.status(error.status||500).json({message:error.message||'Failed to apply Cost Code import.'});}});
router.get('/onboarding/summary',requirePermission(PERMISSIONS.COMMERCIAL_READ),async(req,res)=>{try{const client=await withActiveClient(req,res);if(!client)return;const result=await getCostCodeOnboardingSummary(client.id);return res.json(result.summary);}catch(error){return res.status(500).json({message:'Failed to load Cost Code onboarding summary.'});}});

router.post("/", requirePermission(PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE), async (req, res) => {
  try {
    const active = await withActiveClient(req, res);
    if (!active) return;
    const body = req.body || {};
    const result = await createCostCode(active.id, body, { auth: req.buildliteAuth });
    sendResult(res, result, "costCode", 201);
  } catch (err) {
    console.error("[Cost codes] CREATE error:", err);
    res.status(500).json({ message: "Failed to create cost code." });
  }
});

router.put("/hierarchy/bulk", requirePermission(PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE), async (req, res) => {
  try {
    const active = await withActiveClient(req, res);
    if (!active) return;
    const body = req.body || {};
    const result = await bulkUpdateCostCodeHierarchy(active.id, body, { auth: req.buildliteAuth });
    if (!result.ok) {
      const payload = { message: result.message };
      if (result.errors) payload.errors = result.errors;
      if (result.costCode) payload.costCode = result.costCode;
      return res.status(result.status || 400).json(payload);
    }
    return res.json({ costCodes: result.costCodes });
  } catch (err) {
    console.error("[Cost codes] BULK HIERARCHY error:", err);
    return res.status(500).json({ message: "Failed to apply cost code hierarchy." });
  }
});

router.get("/:id", requirePermission(PERMISSIONS.COMMERCIAL_READ), async (req, res) => {
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

router.put("/:id/active", requirePermission(PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE), async (req, res) => {
  try {
    const active = await withActiveClient(req, res);
    if (!active) return;
    const body = req.body || {};
    const result = await setCostCodeActive(active.id, req.params.id, body, {
      auth: req.buildliteAuth,
    });
    sendResult(res, result, "costCode");
  } catch (err) {
    console.error("[Cost codes] ACTIVE error:", err);
    res.status(500).json({ message: "Failed to update cost code active state." });
  }
});

router.put("/:id", requirePermission(PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE), async (req, res) => {
  try {
    const active = await withActiveClient(req, res);
    if (!active) return;
    const body = req.body || {};
    const result = await updateCostCode(active.id, req.params.id, body, {
      auth: req.buildliteAuth,
    });
    sendResult(res, result, "costCode");
  } catch (err) {
    console.error("[Cost codes] UPDATE error:", err);
    res.status(500).json({ message: "Failed to save cost code." });
  }
});

module.exports = router;
