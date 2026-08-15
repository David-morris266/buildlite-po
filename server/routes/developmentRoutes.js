/**
 * BL-027A.1 — Development API routes (/api/developments).
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const {
  listDevelopmentsForClient,
  findDevelopmentById,
  createDevelopment,
  updateDevelopment,
} = require("../services/developmentRepository");
const {
  validateCreateBody,
  validateUpdateBody,
} = require("../services/developmentValidation");
const { isValidDevelopmentId } = require("../services/developmentConstants");
const { listPackagesForDevelopment } = require("../services/packageRepository");
const {
  listMatricesForDevelopmentOr404,
} = require("../services/orderMatrixRepository");

const router = express.Router();

function provisionalActor(body = {}) {
  return body.updatedBy || body.createdBy || body.actor || null;
}

router.get("/", async (_req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const developments = await listDevelopmentsForClient(active.id);
    res.json(developments);
  } catch (err) {
    console.error("[Developments] list error:", err);
    res.status(500).json({ message: "Failed to list developments" });
  }
});

router.get("/:id/matrices", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const developmentId = String(req.params.id || "").trim();
    const result = await listMatricesForDevelopmentOr404(active.id, developmentId);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    res.json(result.matrices);
  } catch (err) {
    console.error("[Developments] matrix list error:", err);
    res.status(500).json({ message: "Failed to list development matrices." });
  }
});

router.get("/:id/packages", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const developmentId = String(req.params.id || "").trim();
    const development = await findDevelopmentById(active.id, developmentId);
    if (!development) {
      return res.status(404).json({ message: "Development not found." });
    }

    const packages = await listPackagesForDevelopment(active.id, developmentId);
    res.json(packages);
  } catch (err) {
    console.error("[Developments] package list error:", err);
    res.status(500).json({ message: "Failed to list development packages." });
  }
});

router.get("/:id", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const development = await findDevelopmentById(active.id, req.params.id);
    if (!development) {
      return res.status(404).json({ message: "Development not found" });
    }

    res.json(development);
  } catch (err) {
    console.error("[Developments] get error:", err);
    res.status(500).json({ message: "Failed to load development" });
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
    const suppliedId = body.id ? String(body.id).trim() : "";

    if (suppliedId && !isValidDevelopmentId(suppliedId)) {
      return res.status(400).json({ message: "id must be a valid dev-* identifier." });
    }

    const validation = validateCreateBody({
      ...body,
      id: suppliedId || undefined,
    });
    if (!validation.ok) {
      return res.status(400).json({ message: validation.errors.join(" ") });
    }

    const result = await createDevelopment(active.id, validation.normalized, {
      actor: provisionalActor(body),
    });

    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    res.status(201).json(result.development);
  } catch (err) {
    console.error("[Developments] create error:", err);
    res.status(500).json({ message: "Failed to create development" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const routeId = String(req.params.id || "").trim();
    const body = req.body || {};

    if (body.id != null && String(body.id).trim() !== routeId) {
      return res.status(400).json({ message: "id in body must match route id." });
    }

    const existing = await findDevelopmentById(active.id, routeId);
    if (!existing) {
      return res.status(404).json({ message: "Development not found" });
    }

    if (body.version == null) {
      return res.status(400).json({ message: "version is required." });
    }

    const validation = validateUpdateBody(body, existing);
    if (!validation.ok) {
      return res.status(400).json({ message: validation.errors.join(" ") });
    }

    const patch = { ...body };
    delete patch.id;
    delete patch.version;

    const result = await updateDevelopment(
      active.id,
      routeId,
      patch,
      body.version,
      { actor: provisionalActor(body) }
    );

    if (!result.ok) {
      const payload = { message: result.message };
      if (result.development) payload.development = result.development;
      return res.status(result.status).json(payload);
    }

    res.json(result.development);
  } catch (err) {
    console.error("[Developments] update error:", err);
    res.status(500).json({ message: "Failed to update development" });
  }
});

module.exports = router;
