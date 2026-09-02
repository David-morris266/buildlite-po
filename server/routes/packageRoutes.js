/**
 * BL-027B.1 — Package API routes (/api/packages).
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const { requirePermission, actorFromAuth } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
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
const {
  listApplications,
  createApplication,
  reviseApplication,
  linkApplication,
} = require("../services/paymentApplicationRepository");
const { createPaymentDiscoveredItem, deletePaymentDiscoveredItem } = require('../services/paymentDiscoveredRepository');
const applicationVariations = require('../services/applicationVariationRepository');
const vaAssessments = require('../services/variationAccountCertificateAssessmentRepository');

const router = express.Router();

router.post('/:packageId/certificates/:certificateId/payment-discovered',requirePermission(PERMISSIONS.CERTIFICATE_EDIT),async(req,res)=>{try{const active=await getActiveClient();if(!active)return res.status(404).json({message:'No active client set'});const result=await createPaymentDiscoveredItem(active.id,req.params.packageId,req.params.certificateId,req.body||{},req.buildliteAuth);if(!result.ok)return res.status(result.status).json({message:result.message});res.status(201).json(result.item);}catch(error){console.error('[Packages] create payment-discovered error:',error);res.status(error.status||500).json({message:error.message||'Failed to create payment-discovered item.'});}});
router.delete('/:packageId/certificates/:certificateId/payment-discovered/:itemId',requirePermission(PERMISSIONS.CERTIFICATE_EDIT),async(req,res)=>{try{const active=await getActiveClient();if(!active)return res.status(404).json({message:'No active client set'});const result=await deletePaymentDiscoveredItem(active.id,req.params.packageId,req.params.certificateId,req.params.itemId,req.buildliteAuth);if(!result.ok)return res.status(result.status).json({message:result.message});res.status(204).end();}catch(error){res.status(error.status||500).json({message:error.message||'Failed to remove payment-discovered item.'});}});
const assessmentResult=(res,result)=>result.ok?(result.status===204?res.status(204).end():res.status(result.status||200).json(result)):res.status(result.status).json({message:result.message});
router.get('/:packageId/certificates/:certificateId/variation-assessments',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_VIEW),async(req,res)=>{try{const active=await getActiveClient();assessmentResult(res,await vaAssessments.listReadiness(active.id,req.params.packageId,req.params.certificateId,req.buildliteAuth));}catch(error){res.status(error.status||500).json({message:error.message||'Failed to load VA assessment readiness.'});}});
router.post('/:packageId/certificates/:certificateId/variation-assessments',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_ASSESS),async(req,res)=>{try{const active=await getActiveClient();assessmentResult(res,await vaAssessments.saveAssessment(active.id,req.params.packageId,req.params.certificateId,req.body||{},req.buildliteAuth));}catch(error){res.status(error.status||500).json({message:error.message||'Failed to save VA assessment.'});}});
router.delete('/:packageId/certificates/:certificateId/variation-assessments/:assessmentId',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_ASSESS),async(req,res)=>{try{const active=await getActiveClient();assessmentResult(res,await vaAssessments.withdrawAssessment(active.id,req.params.packageId,req.params.certificateId,req.params.assessmentId,req.buildliteAuth));}catch(error){res.status(error.status||500).json({message:error.message||'Failed to withdraw VA assessment.'});}});

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

router.get("/:packageId/payment-applications", async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(500).json({ message: "Database not configured" });
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const result = await listApplications(active.id, req.params.packageId, req.query.certificateId || null);
    if (!result.ok) return sendCertificateError(res, result);
    res.json({ applications: result.applications });
  } catch (err) {
    console.error("[Packages] list payment applications error:", err);
    res.status(500).json({ message: "Failed to load subcontractor applications." });
  }
});

router.post("/:packageId/payment-applications", async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(500).json({ message: "Database not configured" });
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const result = await createApplication(active.id, req.params.packageId, req.body || {});
    if (!result.ok) return sendCertificateError(res, result);
    res.status(result.status || 201).json(result.application);
  } catch (err) {
    console.error("[Packages] create payment application error:", err);
    res.status(500).json({ message: "Failed to record subcontractor application." });
  }
});

router.post("/:packageId/payment-applications/:applicationId/revisions", async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(500).json({ message: "Database not configured" });
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const result = await reviseApplication(active.id, req.params.packageId, req.params.applicationId, req.body || {});
    if (!result.ok) return sendCertificateError(res, result);
    res.status(result.status || 201).json(result.application);
  } catch (err) {
    console.error("[Packages] revise payment application error:", err);
    res.status(500).json({ message: "Failed to revise subcontractor application." });
  }
});

router.post("/:packageId/payment-applications/:applicationId/link", async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(500).json({ message: "Database not configured" });
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });
    const result = await linkApplication(active.id, req.params.packageId, req.params.applicationId, req.body || {});
    if (!result.ok) return sendCertificateError(res, result);
    res.json(result.application);
  } catch (err) {
    console.error("[Packages] link payment application error:", err);
    res.status(500).json({ message: "Failed to link subcontractor application." });
  }
});

const variationResult=(res,result)=>result.ok?res.status(result.status||200).json(result.line?{line:result.line,itemId:result.itemId}:result):res.status(result.status).json({message:result.message});
router.get('/:packageId/payment-applications/:applicationId/variation-lines',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_VIEW),async(req,res)=>{try{const active=await getActiveClient();variationResult(res,await applicationVariations.listLines(active.id,req.params.packageId,req.params.applicationId,req.buildliteAuth));}catch(error){res.status(error.status||500).json({message:error.message||'Failed to load application variations.'});}});
router.post('/:packageId/payment-applications/:applicationId/variation-lines',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_CREATE),async(req,res)=>{try{const active=await getActiveClient();variationResult(res,await applicationVariations.addLine(active.id,req.params.packageId,req.params.applicationId,req.body||{},req.buildliteAuth));}catch(error){res.status(error.status||500).json({message:error.message||'Failed to record application variation.'});}});
router.post('/:packageId/payment-applications/:applicationId/variation-lines/:lineId/match',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_CREATE),async(req,res)=>{try{const active=await getActiveClient();variationResult(res,await applicationVariations.matchLine(active.id,req.params.packageId,req.params.applicationId,req.params.lineId,req.body.variationAccountItemId,req.buildliteAuth));}catch(error){res.status(error.status||500).json({message:error.message||'Failed to match application variation.'});}});
router.post('/:packageId/payment-applications/:applicationId/variation-lines/:lineId/create-variation',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_CREATE),async(req,res)=>{try{const active=await getActiveClient();variationResult(res,await applicationVariations.createVariation(active.id,req.params.packageId,req.params.applicationId,req.params.lineId,req.body||{},req.buildliteAuth));}catch(error){res.status(error.status||500).json({message:error.message||'Failed to create Variation Account item.'});}});
router.post('/:packageId/payment-applications/:applicationId/variation-lines/:lineId/confirm-contractor-position',requirePermission(PERMISSIONS.VARIATION_ACCOUNT_FORECAST_EDIT),async(req,res)=>{try{const active=await getActiveClient();variationResult(res,await applicationVariations.confirmContractorPosition(active.id,req.params.packageId,req.params.applicationId,req.params.lineId,req.body||{},req.buildliteAuth));}catch(error){res.status(error.status||500).json({message:error.message||'Failed to confirm contractor position.'});}});

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

router.post("/:packageId/certificates/:certificateId/approve", requirePermission(PERMISSIONS.CERTIFICATE_LOCK), async (req, res) => {
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
      { actor: actorFromAuth(req.buildliteAuth,PERMISSIONS.CERTIFICATE_LOCK).actor, auth:req.buildliteAuth }
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
