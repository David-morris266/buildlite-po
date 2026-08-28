const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const repository = require("../services/variationOrderRepository");

const router = express.Router();

async function activeClient(res) {
  if (!isDbConfigured()) { res.status(500).json({ message: "Database not configured" }); return null; }
  const active = await getActiveClient();
  if (!active) res.status(404).json({ message: "No active client set" });
  return active;
}

router.get("/", async (req, res) => {
  try {
    const active = await activeClient(res); if (!active) return;
    res.json(await repository.listVariationOrders(active.id, { packageId: req.query.packageId }));
  } catch (error) { console.error("[VariationOrders] list error:", error); res.status(500).json({ message: "Failed to list Variation Orders." }); }
});

router.post("/", async (req, res) => {
  try {
    const active = await activeClient(res); if (!active) return;
    const result = await repository.createDraftVariationOrder(active.id, req.body || {}, { actor: repository.actorFrom(req.body) });
    res.status(result.status).json(result.ok ? result.variationOrder : { message: result.message });
  } catch (error) { console.error("[VariationOrders] create error:", error); res.status(500).json({ message: "Failed to create Variation Order." }); }
});

router.post("/from-commercial-event/:commercialEventId", async (req, res) => {
  try {
    const active = await activeClient(res); if (!active) return;
    const result = await repository.createDraftVariationOrderFromCommercialEvent(active.id, req.params.commercialEventId, req.body || {}, { actor: repository.actorFrom(req.body) });
    const payload = result.ok ? result.variationOrder : { message: result.message, existingVariationOrder: result.existingVariationOrder || null };
    res.status(result.status).json(payload);
  } catch (error) { console.error("[VariationOrders] create from CE error:", error); res.status(500).json({ message: "Failed to create Variation Order." }); }
});

router.get("/:id", async (req, res) => {
  try {
    const active = await activeClient(res); if (!active) return;
    const result = await repository.getVariationOrder(active.id, req.params.id);
    if (!result) return res.status(404).json({ message: "Variation Order not found." });
    res.json(result);
  } catch (error) { console.error("[VariationOrders] get error:", error); res.status(500).json({ message: "Failed to load Variation Order." }); }
});

router.put("/:id", async (req, res) => {
  try {
    const active = await activeClient(res); if (!active) return;
    const result = await repository.updateDraftVariationOrder(active.id, req.params.id, req.body || {}, { actor: repository.actorFrom(req.body) });
    res.status(result.status).json(result.ok ? result.variationOrder : { message: result.message });
  } catch (error) { console.error("[VariationOrders] update error:", error); res.status(500).json({ message: "Failed to update Variation Order." }); }
});

router.post("/:id/approve-and-issue", async (req, res) => {
  try {
    const active = await activeClient(res); if (!active) return;
    const result = await repository.approveAndIssueVariationOrder(active.id, req.params.id, req.body || {}, { actor: repository.actorFrom(req.body) });
    res.status(result.status).json(result.ok ? result.variationOrder : { message: result.message });
  } catch (error) { console.error("[VariationOrders] approve and issue error:", error); res.status(500).json({ message: "Failed to approve and issue Variation Order." }); }
});

for (const action of ["submit", "approve", "issue", "reject"]) {
  router.post(`/:id/${action}`, async (req, res) => {
    try {
      const active = await activeClient(res); if (!active) return;
      const result = await repository.transitionVariationOrder(active.id, req.params.id, action, req.body || {}, { actor: repository.actorFrom(req.body) });
      res.status(result.status).json(result.ok ? result.variationOrder : { message: result.message });
    } catch (error) { console.error(`[VariationOrders] ${action} error:`, error); res.status(500).json({ message: `Failed to ${action} Variation Order.` }); }
  });
}

module.exports = router;
