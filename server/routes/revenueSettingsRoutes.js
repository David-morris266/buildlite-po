/**
 * BL-032A — Development revenue settings API
 * GET/PUT /api/developments/:developmentId/revenue/settings
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const {
  getRevenueSettings,
  putRevenueSettings,
  provisionalActor,
} = require("../services/revenueSettingsRepository");

const router = express.Router({ mergeParams: true });

function sendResult(res, result, successStatus = 200) {
  if (!result.ok) {
    const payload = { message: result.message };
    if (result.errors) payload.errors = result.errors;
    if (result.settings) payload.settings = result.settings;
    return res.status(result.status || 400).json(payload);
  }
  return res.status(result.status || successStatus).json(result.settings);
}

router.get("/revenue/settings", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await getRevenueSettings(active.id, req.params.developmentId);
    sendResult(res, result);
  } catch (err) {
    console.error("[Revenue settings] GET error:", err);
    res.status(500).json({ message: "Failed to load revenue settings." });
  }
});

router.put("/revenue/settings", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await putRevenueSettings(active.id, req.params.developmentId, body, {
      actor: provisionalActor(body),
    });
    sendResult(res, result, result.status === 201 ? 201 : 200);
  } catch (err) {
    console.error("[Revenue settings] PUT error:", err);
    res.status(500).json({ message: "Failed to save revenue settings." });
  }
});

module.exports = router;
