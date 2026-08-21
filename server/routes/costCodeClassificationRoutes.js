/**
 * BL-033B — Cost-code semantic classification API
 * GET  /api/cost-code-classifications
 * GET  /api/cost-code-classifications/:costCodeKey
 * PUT  /api/cost-code-classifications/:costCodeKey
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const {
  getClassification,
  listClassifications,
  provisionalActor,
  putClassification,
} = require("../services/costCodeClassificationRepository");

const router = express.Router();

function sendClassification(res, result, successStatus = 200) {
  if (!result.ok) {
    const payload = { message: result.message };
    if (result.errors) payload.errors = result.errors;
    if (result.classification) payload.classification = result.classification;
    return res.status(result.status || 400).json(payload);
  }
  return res.status(result.status || successStatus).json(result.classification);
}

router.get("/", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const result = await listClassifications(active.id);
    res.status(200).json(result);
  } catch (err) {
    console.error("[Cost-code classification] LIST error:", err);
    res.status(500).json({ message: "Failed to load cost-code classifications." });
  }
});

router.get("/:costCodeKey", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const result = await getClassification(active.id, req.params.costCodeKey);
    sendClassification(res, result);
  } catch (err) {
    console.error("[Cost-code classification] GET error:", err);
    res.status(500).json({ message: "Failed to load cost-code classification." });
  }
});

router.put("/:costCodeKey", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const body = req.body || {};
    const result = await putClassification(active.id, req.params.costCodeKey, body, {
      actor: provisionalActor(body),
    });
    sendClassification(res, result, result.status === 201 ? 201 : 200);
  } catch (err) {
    console.error("[Cost-code classification] PUT error:", err);
    res.status(500).json({ message: "Failed to save cost-code classification." });
  }
});

module.exports = router;
