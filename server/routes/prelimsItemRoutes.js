/**
 * BL-033D.1 / BL-033D.x.3 / BL-033D.x.4B — Development Prelims items + setup + adoption review
 * GET/POST /api/developments/:developmentId/prelims-items
 * GET/PUT  /api/developments/:developmentId/prelims-items/:itemId
 * GET      /api/developments/:developmentId/prelims-setup/preview
 * POST     /api/developments/:developmentId/prelims-setup/apply
 * GET      /api/developments/:developmentId/prelims-adoption/preview (read-only)
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const {
  listPrelimsItems,
  getPrelimsItem,
  createPrelimsItem,
  updatePrelimsItem,
  provisionalActor,
} = require("../services/prelimsItemRepository");
const { previewPrelimsSetup, applyPrelimsSetup } = require("../services/prelimsSetupService");
const {
  buildPrelimsAdoptionReviewPreview,
} = require("../services/prelimsAdoptionPreviewService");

const router = express.Router({ mergeParams: true });

function sendResult(res, result, successKey, successStatus = 200) {
  if (!result.ok) {
    const payload = { message: result.message };
    if (result.errors) payload.errors = result.errors;
    if (result.item) payload.item = result.item;
    if (result.collection) payload.collection = result.collection;
    if (result.blockers) payload.blockers = result.blockers;
    return res.status(result.status || 400).json(payload);
  }
  return res.status(result.status || successStatus).json(result[successKey]);
}

router.get("/prelims-adoption/preview", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const result = await buildPrelimsAdoptionReviewPreview(active.id, req.params.developmentId, {
      reportingMonth: req.query.reportingMonth,
    });
    sendResult(res, result, "preview");
  } catch (err) {
    console.error("[Prelims adoption] PREVIEW error:", err);
    res.status(500).json({ message: "Failed to load Prelims adoption review preview." });
  }
});

router.get("/prelims-setup/preview", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const result = await previewPrelimsSetup(active.id, req.params.developmentId, {
      templateId: req.query.templateId,
      reportingMonth: req.query.reportingMonth,
    });
    sendResult(res, result, "preview");
  } catch (err) {
    console.error("[Prelims setup] PREVIEW error:", err);
    res.status(500).json({ message: "Failed to load Prelims setup preview." });
  }
});

router.post("/prelims-setup/apply", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const body = req.body || {};
    const result = await applyPrelimsSetup(active.id, req.params.developmentId, body, {
      actor: provisionalActor(body),
    });
    sendResult(res, result, "apply");
  } catch (err) {
    console.error("[Prelims setup] APPLY error:", err);
    res.status(500).json({ message: "Failed to create selected Prelims lines." });
  }
});

router.get("/prelims-items", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const result = await listPrelimsItems(active.id, req.params.developmentId, {
      reportingMonth: req.query.reportingMonth,
    });
    sendResult(res, result, "collection");
  } catch (err) {
    console.error("[Prelims] LIST error:", err);
    res.status(500).json({ message: "Failed to load development Prelims lines." });
  }
});

router.post("/prelims-items", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const body = req.body || {};
    const result = await createPrelimsItem(active.id, req.params.developmentId, body, {
      actor: provisionalActor(body),
    });
    sendResult(res, result, "item", 201);
  } catch (err) {
    console.error("[Prelims] POST error:", err);
    res.status(500).json({ message: "Failed to create development Prelims line." });
  }
});

router.get("/prelims-items/:itemId", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const result = await getPrelimsItem(active.id, req.params.developmentId, req.params.itemId, {
      reportingMonth: req.query.reportingMonth,
    });
    sendResult(res, result, "item");
  } catch (err) {
    console.error("[Prelims] GET error:", err);
    res.status(500).json({ message: "Failed to load development Prelims line." });
  }
});

router.put("/prelims-items/:itemId", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const body = req.body || {};
    const result = await updatePrelimsItem(
      active.id,
      req.params.developmentId,
      req.params.itemId,
      body,
      { actor: provisionalActor(body) }
    );
    sendResult(res, result, "item");
  } catch (err) {
    console.error("[Prelims] PUT error:", err);
    res.status(500).json({ message: "Failed to save development Prelims line." });
  }
});

module.exports = router;
