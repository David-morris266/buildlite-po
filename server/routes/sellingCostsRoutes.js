/**
 * BL-034B — Development Selling Costs proposal API
 * GET/PUT /api/developments/:developmentId/selling-costs
 * BL-034C — GET /api/developments/:developmentId/selling-costs/review
 * BL-034D — POST /api/developments/:developmentId/selling-costs/adoption
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const {
  getSellingCostsProposal,
  putSellingCostsAssumption,
  provisionalActor,
} = require("../services/sellingCostsRepository");
const { buildSellingCostsReviewPreview } = require("../services/sellingCostsReviewPreviewService");
const { adoptSellingCostsForecasts } = require("../services/sellingCostsAdoptionApplyService");

const router = express.Router({ mergeParams: true });

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

router.get("/selling-costs/review", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await buildSellingCostsReviewPreview(active.id, req.params.developmentId);
    sendResult(res, result);
  } catch (err) {
    console.error("[Selling Costs] REVIEW error:", err);
    res.status(500).json({ message: "Failed to load Selling Costs CVR review." });
  }
});

router.post("/selling-costs/adoption", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await adoptSellingCostsForecasts(active.id, req.params.developmentId, body, {
      actor: provisionalActor(body),
    });
    sendResult(res, result, 200, "adoption");
  } catch (err) {
    console.error("[Selling Costs] ADOPTION error:", err);
    res.status(500).json({ message: "Failed to adopt Selling Costs into CVR." });
  }
});

router.get("/selling-costs", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await getSellingCostsProposal(active.id, req.params.developmentId);
    sendResult(res, result);
  } catch (err) {
    console.error("[Selling Costs] GET error:", err);
    res.status(500).json({ message: "Failed to load Selling Costs proposal." });
  }
});

router.put("/selling-costs", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await putSellingCostsAssumption(active.id, req.params.developmentId, body, {
      actor: provisionalActor(body),
    });
    sendResult(res, result, result.status === 201 ? 201 : 200);
  } catch (err) {
    console.error("[Selling Costs] PUT error:", err);
    res.status(500).json({ message: "Failed to save Selling Costs assumption." });
  }
});

module.exports = router;
