/**
 * BL-033C — Development programme API
 * GET/PUT /api/developments/:developmentId/programme
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const {
  getDevelopmentProgramme,
  putDevelopmentProgramme,
  provisionalActor,
} = require("../services/developmentProgrammeRepository");

const router = express.Router({ mergeParams: true });

function sendResult(res, result, successStatus = 200) {
  if (!result.ok) {
    const payload = { message: result.message };
    if (result.errors) payload.errors = result.errors;
    if (result.programme) payload.programme = result.programme;
    return res.status(result.status || 400).json(payload);
  }
  return res.status(result.status || successStatus).json(result.programme);
}

router.get("/programme", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await getDevelopmentProgramme(active.id, req.params.developmentId);
    sendResult(res, result);
  } catch (err) {
    console.error("[Programme] GET error:", err);
    res.status(500).json({ message: "Failed to load development programme." });
  }
});

router.put("/programme", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await putDevelopmentProgramme(active.id, req.params.developmentId, body, {
      actor: provisionalActor(body),
    });
    sendResult(res, result, result.status === 201 ? 201 : 200);
  } catch (err) {
    console.error("[Programme] PUT error:", err);
    res.status(500).json({ message: "Failed to save development programme." });
  }
});

module.exports = router;
