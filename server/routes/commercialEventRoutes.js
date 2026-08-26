/**
 * BL-028A — Commercial Event API routes (/api/commercial-events).
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const {
  listCommercialEvents,
  findCommercialEventById,
  createCommercialEvent,
  updateCommercialEventDraft,
  submitCommercialEvent,
  approveCommercialEvent,
  rejectCommercialEvent,
  closeCommercialEvent,
  dismissPotentialContraCharge,
  createLinkedRecoveryFromOrigin,
  importCommercialEvents,
  updateCommercialEventExpectedLiability,
  provisionalActor,
} = require("../services/commercialEventRepository");

const router = express.Router();

function workflowBody(req) {
  const body = req.body || {};
  return {
    actor: provisionalActor(body),
    comment: body.comment || "",
  };
}

router.get("/", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const filters = {};
    if (req.query.developmentId) filters.developmentId = String(req.query.developmentId);
    if (req.query.packageId) filters.packageUuid = String(req.query.packageId);
    if (req.query.orderKey) filters.orderKey = String(req.query.orderKey);
    if (req.query.status) filters.status = String(req.query.status);
    if (req.query.relationshipType) {
      filters.relationshipType = String(req.query.relationshipType);
    }

    const events = await listCommercialEvents(active.id, filters);
    res.json(events);
  } catch (err) {
    console.error("[CommercialEvents] list error:", err);
    res.status(500).json({ message: "Failed to list commercial events." });
  }
});

router.post("/import", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await importCommercialEvents(active.id, {
      developmentId: body.developmentId,
      events: body.events,
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({ message: result.message });
    }

    res.status(200).json(result.summary);
  } catch (err) {
    console.error("[CommercialEvents] import error:", err);
    res.status(500).json({ message: "Failed to import commercial events." });
  }
});

router.get("/:id", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const event = await findCommercialEventById(active.id, req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Commercial event not found." });
    }

    res.json(event);
  } catch (err) {
    console.error("[CommercialEvents] get error:", err);
    res.status(500).json({ message: "Failed to load commercial event." });
  }
});

router.post("/", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await createCommercialEvent(active.id, body, {
      actor: provisionalActor(body),
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({ message: result.message });
    }

    res.status(result.status || 201).json(result.event);
  } catch (err) {
    console.error("[CommercialEvents] create error:", err);
    res.status(500).json({ message: "Failed to create commercial event." });
  }
});

router.put("/:id", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await updateCommercialEventDraft(
      active.id,
      req.params.id,
      body,
      body.version,
      { actor: provisionalActor(body) }
    );

    if (!result.ok) {
      const payload = { message: result.message };
      if (result.event) payload.event = result.event;
      return res.status(result.status || 400).json(payload);
    }

    res.json(result.event);
  } catch (err) {
    console.error("[CommercialEvents] update error:", err);
    res.status(500).json({ message: "Failed to update commercial event." });
  }
});

router.post("/:id/submit", async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(500).json({ message: "Database not configured" });
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await submitCommercialEvent(active.id, req.params.id, workflowBody(req));
    if (!result.ok) return res.status(result.status || 400).json({ message: result.message });
    res.json(result.event);
  } catch (err) {
    console.error("[CommercialEvents] submit error:", err);
    res.status(500).json({ message: "Failed to submit commercial event." });
  }
});

router.post("/:id/approve", async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(500).json({ message: "Database not configured" });
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await approveCommercialEvent(active.id, req.params.id, workflowBody(req));
    if (!result.ok) return res.status(result.status || 400).json({ message: result.message });
    res.json(result.event);
  } catch (err) {
    console.error("[CommercialEvents] approve error:", err);
    res.status(500).json({ message: "Failed to approve commercial event." });
  }
});

router.post("/:id/reject", async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(500).json({ message: "Database not configured" });
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await rejectCommercialEvent(active.id, req.params.id, workflowBody(req));
    if (!result.ok) return res.status(result.status || 400).json({ message: result.message });
    res.json(result.event);
  } catch (err) {
    console.error("[CommercialEvents] reject error:", err);
    res.status(500).json({ message: "Failed to reject commercial event." });
  }
});

router.post("/:id/close", async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(500).json({ message: "Database not configured" });
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await closeCommercialEvent(active.id, req.params.id, workflowBody(req));
    if (!result.ok) return res.status(result.status || 400).json({ message: result.message });
    res.json(result.event);
  } catch (err) {
    console.error("[CommercialEvents] close error:", err);
    res.status(500).json({ message: "Failed to close commercial event." });
  }
});

router.post("/:id/dismiss-potential-contra", async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(500).json({ message: "Database not configured" });
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await dismissPotentialContraCharge(
      active.id,
      req.params.id,
      workflowBody(req)
    );
    if (!result.ok) return res.status(result.status || 400).json({ message: result.message });
    res.json(result.event);
  } catch (err) {
    console.error("[CommercialEvents] dismiss potential contra error:", err);
    res.status(500).json({ message: "Failed to dismiss potential contra charge." });
  }
});

router.patch("/:id/expected-liability", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await updateCommercialEventExpectedLiability(active.id, req.params.id, body, {
      actor: provisionalActor(body),
    });

    if (!result.ok) {
      const payload = { message: result.message };
      if (result.event) payload.event = result.event;
      if (result.code) payload.code = result.code;
      if (result.errors) payload.errors = result.errors;
      return res.status(result.status || 400).json(payload);
    }

    res.json(result.event);
  } catch (err) {
    console.error("[CommercialEvents] expected liability error:", err);
    res.status(500).json({ message: "Failed to update expected liability." });
  }
});

router.post("/:id/create-linked-recovery", async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(500).json({ message: "Database not configured" });
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await createLinkedRecoveryFromOrigin(active.id, req.params.id, {
      recoveryPackageId: body.recoveryPackageId || body.packageId || body.orderKey,
      recoveryPackageUuid: body.recoveryPackageUuid || body.packageUuid || null,
      actor: provisionalActor(body),
      comment: body.comment || "",
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({ message: result.message });
    }

    res.status(201).json({ origin: result.origin, recovery: result.recovery });
  } catch (err) {
    console.error("[CommercialEvents] linked recovery error:", err);
    res.status(500).json({ message: "Failed to create linked recovery." });
  }
});

module.exports = router;
