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
const {
  getMatrixForPackage,
  getMatrixForOrderKey,
  upsertMatrixForPackage,
} = require("../services/orderMatrixRepository");
const {
  provisionalActor: certificateActor,
  listCertificatesForPackage,
  getCertificateForPackage,
  createCertificateForPackage,
  patchCertificateForPackage,
  submitCertificateForPackage,
  approveCertificateForPackage,
  rejectCertificateForPackage,
  deleteCertificateForPackage,
} = require("../services/paymentCertificateRepository");

const router = express.Router();

function provisionalActor(body = {}) {
  return body.updatedBy || body.createdBy || body.actor || null;
}

router.get("/by-order-key/:orderKey/matrix", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const orderKey = decodeURIComponent(req.params.orderKey || "");
    const result = await getMatrixForOrderKey(active.id, orderKey);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    res.json(result.matrix);
  } catch (err) {
    console.error("[Packages] get matrix by orderKey error:", err);
    res.status(500).json({ message: "Failed to load order matrix." });
  }
});

router.get("/:packageId/matrix", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await getMatrixForPackage(active.id, req.params.packageId);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    res.json(result.matrix);
  } catch (err) {
    console.error("[Packages] get matrix error:", err);
    res.status(500).json({ message: "Failed to load order matrix." });
  }
});

router.put("/:packageId/matrix", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await upsertMatrixForPackage(
      active.id,
      req.params.packageId,
      body,
      body.version,
      { actor: provisionalActor(body) }
    );

    if (!result.ok) {
      const payload = { message: result.message };
      if (result.matrix) payload.matrix = result.matrix;
      return res.status(result.status).json(payload);
    }

    res.status(result.status).json(result.matrix);
  } catch (err) {
    console.error("[Packages] put matrix error:", err);
    res.status(500).json({ message: "Failed to save order matrix." });
  }
});

function sendCertificateError(res, result) {
  const payload = { message: result.message };
  if (result.errors) payload.errors = result.errors;
  if (result.certificate) payload.certificate = result.certificate;
  return res.status(result.status).json(payload);
}

router.get("/:packageId/certificates", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await listCertificatesForPackage(active.id, req.params.packageId);
    if (!result.ok) return sendCertificateError(res, result);
    res.json({ certificates: result.certificates });
  } catch (err) {
    console.error("[Packages] list certificates error:", err);
    res.status(500).json({ message: "Failed to load payment certificates." });
  }
});

router.post("/:packageId/certificates", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await createCertificateForPackage(active.id, req.params.packageId, body, {
      actor: certificateActor(body),
    });
    if (!result.ok) return sendCertificateError(res, result);
    res.status(result.status || 201).json(result.certificate);
  } catch (err) {
    console.error("[Packages] create certificate error:", err);
    res.status(500).json({ message: "Failed to create payment certificate." });
  }
});

router.get("/:packageId/certificates/:certificateId", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await getCertificateForPackage(
      active.id,
      req.params.packageId,
      req.params.certificateId
    );
    if (!result.ok) return sendCertificateError(res, result);
    res.json(result.certificate);
  } catch (err) {
    console.error("[Packages] get certificate error:", err);
    res.status(500).json({ message: "Failed to load payment certificate." });
  }
});

router.patch("/:packageId/certificates/:certificateId", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await patchCertificateForPackage(
      active.id,
      req.params.packageId,
      req.params.certificateId,
      body,
      { actor: certificateActor(body) }
    );
    if (!result.ok) return sendCertificateError(res, result);
    res.json(result.certificate);
  } catch (err) {
    console.error("[Packages] patch certificate error:", err);
    res.status(500).json({ message: "Failed to update payment certificate." });
  }
});

router.post("/:packageId/certificates/:certificateId/submit", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await submitCertificateForPackage(
      active.id,
      req.params.packageId,
      req.params.certificateId,
      body,
      { actor: certificateActor(body) }
    );
    if (!result.ok) return sendCertificateError(res, result);
    res.json(result.certificate);
  } catch (err) {
    console.error("[Packages] submit certificate error:", err);
    res.status(500).json({ message: "Failed to submit payment certificate." });
  }
});

router.post("/:packageId/certificates/:certificateId/approve", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await approveCertificateForPackage(
      active.id,
      req.params.packageId,
      req.params.certificateId,
      body,
      { actor: certificateActor(body) }
    );
    if (!result.ok) return sendCertificateError(res, result);
    res.json(result.certificate);
  } catch (err) {
    console.error("[Packages] approve certificate error:", err);
    res.status(500).json({ message: "Failed to approve payment certificate." });
  }
});

router.post("/:packageId/certificates/:certificateId/reject", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await rejectCertificateForPackage(
      active.id,
      req.params.packageId,
      req.params.certificateId,
      body,
      { actor: certificateActor(body) }
    );
    if (!result.ok) return sendCertificateError(res, result);
    res.json(result.certificate);
  } catch (err) {
    console.error("[Packages] reject certificate error:", err);
    res.status(500).json({ message: "Failed to reject payment certificate." });
  }
});

router.delete("/:packageId/certificates/:certificateId", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }

    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await deleteCertificateForPackage(
      active.id,
      req.params.packageId,
      req.params.certificateId,
      body,
      { actor: certificateActor(body) }
    );
    if (!result.ok) return sendCertificateError(res, result);
    res.status(204).end();
  } catch (err) {
    console.error("[Packages] delete certificate error:", err);
    res.status(500).json({ message: "Failed to delete payment certificate." });
  }
});

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
