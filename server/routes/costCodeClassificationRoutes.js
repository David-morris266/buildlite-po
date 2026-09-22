/**
 * BL-033B — Cost-code semantic classification API
 * GET  /api/cost-code-classifications
 * GET  /api/cost-code-classifications/:costCodeKey
 * PUT  /api/cost-code-classifications/:costCodeKey
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { requirePermission, actorFromAuth } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const { getActiveClient } = require('../services/activeClient');
const {
  getClassification,
  listClassifications,
  putClassification,
  previewBulkClassifications,
  applyBulkClassifications,
} = require("../services/costCodeClassificationRepository");

const router = express.Router();
async function tenantId(req) {
  if (req.buildliteAuth?.clientId) return req.buildliteAuth.clientId;
  if (process.env.BUILDLITE_SERVER_TEST === '1' || process.env.NODE_ENV === 'test') return (await getActiveClient())?.id || null;
  return null;
}

function sendClassification(res, result, successStatus = 200) {
  if (!result.ok) {
    const payload = { message: result.message };
    if (result.errors) payload.errors = result.errors;
    if (result.classification) payload.classification = result.classification;
    return res.status(result.status || 400).json(payload);
  }
  return res.status(result.status || successStatus).json(result.classification);
}

router.get("/", requirePermission(PERMISSIONS.COMMERCIAL_READ), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const result = await listClassifications(await tenantId(req));
    res.status(200).json(result);
  } catch (err) {
    console.error("[Cost-code classification] LIST error:", err);
    res.status(500).json({ message: "Failed to load cost-code classifications." });
  }
});

router.post('/bulk/preview', requirePermission(PERMISSIONS.COST_CODE_CLASSIFICATIONS_MANAGE), async(req,res)=>{
  try { const result=await previewBulkClassifications(await tenantId(req),req.body||{}); if(!result.ok)return res.status(result.status||400).json(result); return res.json(result); }
  catch(error){console.error('[Cost-code classification] BULK PREVIEW error:',error);return res.status(500).json({message:'Failed to preview cost-code classifications.'});}
});

router.post('/bulk/apply', requirePermission(PERMISSIONS.COST_CODE_CLASSIFICATIONS_MANAGE), async(req,res)=>{
  try { const result=await applyBulkClassifications(await tenantId(req),req.body||{},actorFromAuth(req.buildliteAuth,PERMISSIONS.COST_CODE_CLASSIFICATIONS_MANAGE)); if(!result.ok)return res.status(result.status||400).json(result); return res.json(result); }
  catch(error){console.error('[Cost-code classification] BULK APPLY error:',error);return res.status(500).json({message:'Failed to apply cost-code classifications.'});}
});

router.get("/:costCodeKey", requirePermission(PERMISSIONS.COMMERCIAL_READ), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const result = await getClassification(await tenantId(req), req.params.costCodeKey);
    sendClassification(res, result);
  } catch (err) {
    console.error("[Cost-code classification] GET error:", err);
    res.status(500).json({ message: "Failed to load cost-code classification." });
  }
});

router.put("/:costCodeKey", requirePermission(PERMISSIONS.COST_CODE_CLASSIFICATIONS_MANAGE), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const body = req.body || {};
    const result = await putClassification(await tenantId(req), req.params.costCodeKey, body,
      actorFromAuth(req.buildliteAuth, PERMISSIONS.COST_CODE_CLASSIFICATIONS_MANAGE));
    sendClassification(res, result, result.status === 201 ? 201 : 200);
  } catch (err) {
    console.error("[Cost-code classification] PUT error:", err);
    res.status(500).json({ message: "Failed to save cost-code classification." });
  }
});

module.exports = router;
