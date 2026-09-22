/**
 * BL-034B — Development Selling Costs proposal API
 * GET/PUT /api/developments/:developmentId/selling-costs
 * BL-034C — GET /api/developments/:developmentId/selling-costs/review
 * BL-034D — POST /api/developments/:developmentId/selling-costs/adoption
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require('../services/activeClient');
const {
  getSellingCostsProposal,
  putSellingCostsAssumption,
} = require("../services/sellingCostsRepository");
const { buildSellingCostsReviewPreview } = require("../services/sellingCostsReviewPreviewService");
const { adoptSellingCostsForecasts } = require("../services/sellingCostsAdoptionApplyService");
const { PERMISSIONS } = require('../auth/permissions');
const { requirePermission, actorFromAuth } = require('../auth/authorization');

const router = express.Router({ mergeParams: true });
async function tenantId(req){if(req.buildliteAuth?.clientId)return req.buildliteAuth.clientId;if(process.env.BUILDLITE_SERVER_TEST==='1'||process.env.NODE_ENV==='test')return (await getActiveClient())?.id||null;return null;}

function sendResult(res, result, successStatus = 200, payloadKey) {
  if (!result.ok) {
    const payload = { message: result.message };
    if (result.errors) payload.errors = result.errors;
    if (result.proposal) payload.proposal = result.proposal;
    if (result.destination) payload.destination = result.destination;
    if (result.blockers) payload.blockers = result.blockers;
    if (result.code) payload.code = result.code;
    if (result.costCodeKey) payload.costCodeKey = result.costCodeKey;
    if (result.periodStatus) payload.periodStatus = result.periodStatus;
    if (result.expectedPeriodKey) payload.expectedPeriodKey = result.expectedPeriodKey;
    if (result.actualPeriodKey) payload.actualPeriodKey = result.actualPeriodKey;
    if (result.expectedReportingMonth) {
      payload.expectedReportingMonth = result.expectedReportingMonth;
    }
    if (result.actualReportingMonth) payload.actualReportingMonth = result.actualReportingMonth;
    if (result.expectedSettingsVersion != null) {
      payload.expectedSettingsVersion = result.expectedSettingsVersion;
    }
    if (result.actualSettingsVersion != null) {
      payload.actualSettingsVersion = result.actualSettingsVersion;
    }
    if (result.input) payload.input = result.input;
    return res.status(result.status || 400).json(payload);
  }
  if (payloadKey) {
    return res.status(result.status || successStatus).json(result[payloadKey]);
  }
  const body = result.preview || result.proposal;
  return res.status(result.status || successStatus).json(body);
}

router.get("/selling-costs/review", requirePermission(PERMISSIONS.COMMERCIAL_READ), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const result = await buildSellingCostsReviewPreview(await tenantId(req), req.params.developmentId);
    sendResult(res, result);
  } catch (err) {
    console.error("[Selling Costs] REVIEW error:", err);
    res.status(500).json({ message: "Failed to load Selling Costs CVR review." });
  }
});

router.post("/selling-costs/adoption", requirePermission(PERMISSIONS.CVR_ADOPT), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const body = req.body || {};
    const authenticated = actorFromAuth(req.buildliteAuth, PERMISSIONS.CVR_ADOPT);
    const result = await adoptSellingCostsForecasts(await tenantId(req), req.params.developmentId, body, {
      actor: authenticated.actor,
      auth: req.buildliteAuth,
    });
    sendResult(res, result, 200, "adoption");
  } catch (err) {
    console.error("[Selling Costs] ADOPTION error:", err);
    res.status(500).json({ message: "Failed to adopt Selling Costs into CVR." });
  }
});

router.get("/selling-costs", requirePermission(PERMISSIONS.COMMERCIAL_READ), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const result = await getSellingCostsProposal(await tenantId(req), req.params.developmentId);
    sendResult(res, result);
  } catch (err) {
    console.error("[Selling Costs] GET error:", err);
    res.status(500).json({ message: "Failed to load Selling Costs proposal." });
  }
});

router.put("/selling-costs", requirePermission(PERMISSIONS.CVR_EDIT), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const body = req.body || {};
    const authenticated = actorFromAuth(req.buildliteAuth, PERMISSIONS.CVR_EDIT);
    const result = await putSellingCostsAssumption(await tenantId(req), req.params.developmentId, body, {
      actor: authenticated.actor,
      auth: req.buildliteAuth,
    });
    sendResult(res, result, result.status === 201 ? 201 : 200);
  } catch (err) {
    console.error("[Selling Costs] PUT error:", err);
    res.status(500).json({ message: "Failed to save Selling Costs assumption." });
  }
});

module.exports = router;
