/**
 * BL-033C — Development programme API
 * GET/PUT /api/developments/:developmentId/programme
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const { requirePermission } = require("../auth/authorization");
const { PERMISSIONS } = require("../auth/permissions");
const {
  getDevelopmentProgramme,
  putDevelopmentProgramme,
} = require("../services/developmentProgrammeRepository");

const router = express.Router({ mergeParams: true });

async function authenticatedTenantId(req) {
  if (req.buildliteAuth?.clientId) return req.buildliteAuth.clientId;
  if (process.env.BUILDLITE_SERVER_TEST === "1" || process.env.NODE_ENV === "test") {
    return (await getActiveClient())?.id || null;
  }
  return null;
}

function sendResult(res, result, successStatus = 200) {
  if (!result.ok) {
    const payload = { message: result.message };
    if (result.errors) payload.errors = result.errors;
    if (result.programme) payload.programme = result.programme;
    return res.status(result.status || 400).json(payload);
  }
  return res.status(result.status || successStatus).json(result.programme);
}

router.get("/programme", requirePermission(PERMISSIONS.COMMERCIAL_READ), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const clientId = await authenticatedTenantId(req);
    if (!clientId) return res.status(403).json({ message: "Authenticated tenant is required." });
    const result = await getDevelopmentProgramme(clientId, req.params.developmentId);
    sendResult(res, result);
  } catch (err) {
    console.error("[Programme] GET error:", err);
    res.status(500).json({ message: "Failed to load development programme." });
  }
});

router.put("/programme", requirePermission(PERMISSIONS.CVR_EDIT), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const body = req.body || {};
    const clientId = await authenticatedTenantId(req);
    if (!clientId) return res.status(403).json({ message: "Authenticated tenant is required." });
    const result = await putDevelopmentProgramme(
      clientId,
      req.params.developmentId,
      body,
      {
        auth: { ...req.buildliteAuth, clientId },
      }
    );
    sendResult(res, result, result.status === 201 ? 201 : 200);
  } catch (err) {
    console.error("[Programme] PUT error:", err);
    res.status(500).json({ message: "Failed to save development programme." });
  }
});

module.exports = router;
