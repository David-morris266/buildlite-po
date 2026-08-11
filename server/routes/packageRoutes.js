/**
 * BL-027B.1 — Package API routes (/api/packages).
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const {
  findPackageById,
  findPackageByOrderKey,
} = require("../services/packageRepository");
const {
  materialisePackagesFromApprovedPos,
  materialisePackageFromPoNumber,
} = require("../services/packageMaterialisation");

const router = express.Router();

function provisionalActor(body = {}) {
  return body.updatedBy || body.createdBy || body.actor || null;
}

router.get("/by-order-key/:orderKey", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const orderKey = decodeURIComponent(req.params.orderKey || "");
    const pkg = await findPackageByOrderKey(active.id, orderKey);
    if (!pkg) {
      return res.status(404).json({ message: "Package not found." });
    }

    res.json(pkg);
  } catch (err) {
    console.error("[Packages] get by orderKey error:", err);
    res.status(500).json({ message: "Failed to load package." });
  }
});

router.get("/:packageId", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const pkg = await findPackageById(active.id, req.params.packageId);
    if (!pkg) {
      return res.status(404).json({ message: "Package not found." });
    }

    res.json(pkg);
  } catch (err) {
    console.error("[Packages] get error:", err);
    res.status(500).json({ message: "Failed to load package." });
  }
});

router.post("/materialise", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await materialisePackagesFromApprovedPos(active.id, {
      actor: provisionalActor(body),
      developmentId: body.developmentId || null,
    });

    res.json(result);
  } catch (err) {
    console.error("[Packages] materialise error:", err);
    res.status(500).json({ message: "Failed to materialise packages." });
  }
});

router.post("/materialise-from-po/:poNumber", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await materialisePackageFromPoNumber(
      active.id,
      req.params.poNumber,
      { actor: provisionalActor(req.body || {}) }
    );

    if (!result.ok) {
      return res.status(result.status).json({
        message: result.message,
        reason: result.reason || null,
      });
    }

    res.status(result.status).json({
      created: result.created,
      package: result.package,
    });
  } catch (err) {
    console.error("[Packages] materialise-from-po error:", err);
    res.status(500).json({ message: "Failed to materialise package from PO." });
  }
});

module.exports = router;
