/**
 * BL-031A / BL-031E.3B / BL-033D.x.4C.1 / BL-037A — CVR period API
 * (/api/developments/:developmentId/cvr/...).
 *
 * Approve & Lock persists an immutable snapshot atomically. Client historic
 * snapshot rendering is BL-031E.4.
 * Prelims adoption is a Draft-only command (no client UI in x.4C.1).
 * BL-037A membership is a Draft-only Master-backed empty overlay command.
 * BL-037B budget import applies Master-validated budgets atomically.
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const { requirePermission, actorFromAuth } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const {
  acknowledgeVariationExposureException,
  approveCvrPeriod,
  createCostCodeInput,
  createCvrPeriod,
  getCvrPeriod,
  listCostCodeInputs,
  listCvrPeriods,
  patchCostCodeInput,
  patchCvrPeriod,
  provisionalActor,
  rejectCvrPeriod,
  submitCvrPeriod,
  upsertCostCodeInputs,
} = require("../services/cvrPeriodRepository");
const { adoptPrelimsForecasts } = require("../services/prelimsAdoptionApplyService");
const { addDraftCvrCostCodeMember } = require("../services/cvrMembershipService");
const { importDraftCvrBudget } = require("../services/cvrBudgetImportService");

const router = express.Router({ mergeParams: true });

function sendResult(res, result, successStatus = 200, payloadKey) {
  if (!result.ok) {
    const payload = { message: result.message };
    if (result.errors) payload.errors = result.errors;
    if (result.period) payload.period = result.period;
    if (result.input) payload.input = result.input;
    if (result.duplicates) payload.duplicates = result.duplicates;
    if (result.code) payload.code = result.code;
    if (result.blockers) payload.blockers = result.blockers;
    if (result.costCodeKey) payload.costCodeKey = result.costCodeKey;
    if (result.periodStatus) payload.periodStatus = result.periodStatus;
    if (result.unknownCodes) payload.unknownCodes = result.unknownCodes;
    if (result.inactiveCodes) payload.inactiveCodes = result.inactiveCodes;
    if (result.duplicateCodes) payload.duplicateCodes = result.duplicateCodes;
    if (result.invalidBudget) payload.invalidBudget = result.invalidBudget;
    if (result.expectedReportingMonth) {
      payload.expectedReportingMonth = result.expectedReportingMonth;
    }
    if (result.actualReportingMonth) {
      payload.actualReportingMonth = result.actualReportingMonth;
    }
    return res.status(result.status || 400).json(payload);
  }
  if (payloadKey) {
    return res.status(result.status || successStatus).json(result[payloadKey]);
  }
  return res.status(result.status || successStatus).json(result);
}

router.get("/cvr/periods", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await listCvrPeriods(active.id, req.params.developmentId);
    if (!result.ok) return sendResult(res, result);
    res.json({ periods: result.periods });
  } catch (err) {
    console.error("[CVR] list periods error:", err);
    res.status(500).json({ message: "Failed to list CVR periods." });
  }
});

router.post("/cvr/periods", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await createCvrPeriod(active.id, req.params.developmentId, body, {
      actor: provisionalActor(body),
    });
    sendResult(res, result, 201, "period");
  } catch (err) {
    console.error("[CVR] create period error:", err);
    res.status(500).json({ message: "Failed to create CVR period." });
  }
});

router.get("/cvr/periods/:periodId", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await getCvrPeriod(
      active.id,
      req.params.developmentId,
      req.params.periodId
    );
    sendResult(res, result, 200, "period");
  } catch (err) {
    console.error("[CVR] get period error:", err);
    res.status(500).json({ message: "Failed to load CVR period." });
  }
});

router.patch("/cvr/periods/:periodId", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await patchCvrPeriod(
      active.id,
      req.params.developmentId,
      req.params.periodId,
      body,
      { actor: provisionalActor(body) }
    );
    sendResult(res, result, 200, "period");
  } catch (err) {
    console.error("[CVR] patch period error:", err);
    res.status(500).json({ message: "Failed to update CVR period." });
  }
});

router.post("/cvr/periods/:periodId/submit", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await submitCvrPeriod(
      active.id,
      req.params.developmentId,
      req.params.periodId,
      body,
      { actor: provisionalActor(body) }
    );
    sendResult(res, result, 200, "period");
  } catch (err) {
    console.error("[CVR] submit period error:", err);
    res.status(500).json({ message: "Failed to submit CVR period." });
  }
});

router.post("/cvr/periods/:periodId/reject", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await rejectCvrPeriod(
      active.id,
      req.params.developmentId,
      req.params.periodId,
      body,
      { actor: provisionalActor(body) }
    );
    sendResult(res, result, 200, "period");
  } catch (err) {
    console.error("[CVR] reject period error:", err);
    res.status(500).json({ message: "Failed to reject CVR period." });
  }
});

router.post("/cvr/periods/:periodId/approve", requirePermission(PERMISSIONS.CVR_LOCK), async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await approveCvrPeriod(
      active.id,
      req.params.developmentId,
      req.params.periodId,
      body,
      { actor: actorFromAuth(req.buildliteAuth, PERMISSIONS.CVR_LOCK).actor, auth:req.buildliteAuth }
    );
    sendResult(res, result, 200, "period");
  } catch (err) {
    console.error("[CVR] approve period error:", err);
    res.status(500).json({ message: "Failed to approve CVR period." });
  }
});

router.post("/cvr/periods/:periodId/variation-exposure/acknowledgements", requirePermission(PERMISSIONS.CVR_LOCK), async (req, res) => {
  try {
    if (!isDbConfigured()) return res.status(500).json({ message: 'Database not configured' });
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: 'No active client set' });
    const result = await acknowledgeVariationExposureException(active.id, req.params.developmentId, req.params.periodId, req.body || {}, { auth: req.buildliteAuth });
    sendResult(res, result, 201, 'period');
  } catch (err) {
    console.error('[CVR] acknowledge Variation exposure error:', err);
    res.status(err.status || 500).json({ message: err.message || 'Failed to acknowledge Variation exposure.' });
  }
});

router.get("/cvr/periods/:periodId/inputs", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const result = await listCostCodeInputs(
      active.id,
      req.params.developmentId,
      req.params.periodId
    );
    if (!result.ok) return sendResult(res, result);
    res.json({ inputs: result.inputs });
  } catch (err) {
    console.error("[CVR] list inputs error:", err);
    res.status(500).json({ message: "Failed to list CVR cost-code inputs." });
  }
});

router.put("/cvr/periods/:periodId/inputs", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await upsertCostCodeInputs(
      active.id,
      req.params.developmentId,
      req.params.periodId,
      body,
      { actor: provisionalActor(body) }
    );
    if (!result.ok) return sendResult(res, result);
    res.json({ inputs: result.inputs });
  } catch (err) {
    console.error("[CVR] upsert inputs error:", err);
    res.status(500).json({ message: "Failed to upsert CVR cost-code inputs." });
  }
});

/**
 * BL-037A — Authoritative Draft CVR membership. Empty overlay from Cost Code
 * Master. Does not replace POST /inputs (legacy overlay create).
 */
router.post("/cvr/periods/:periodId/cost-code-members", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await addDraftCvrCostCodeMember(
      active.id,
      req.params.developmentId,
      req.params.periodId,
      body,
      { actor: provisionalActor(body) }
    );
    sendResult(res, result, 201, "input");
  } catch (err) {
    console.error("[CVR] add cost-code member error:", err);
    res.status(500).json({ message: "Failed to add CVR cost-code member." });
  }
});

router.post("/cvr/periods/:periodId/budget-import", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await importDraftCvrBudget(
      active.id,
      req.params.developmentId,
      req.params.periodId,
      body,
      { actor: provisionalActor(body) }
    );
    sendResult(res, result);
  } catch (err) {
    console.error("[CVR] budget import error:", err);
    res.status(500).json({ message: "Failed to import CVR budget." });
  }
});

router.post("/cvr/periods/:periodId/inputs", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await createCostCodeInput(
      active.id,
      req.params.developmentId,
      req.params.periodId,
      body,
      { actor: provisionalActor(body) }
    );
    sendResult(res, result, 201, "input");
  } catch (err) {
    console.error("[CVR] create input error:", err);
    res.status(500).json({ message: "Failed to create CVR cost-code input." });
  }
});

router.patch("/cvr/periods/:periodId/inputs/:inputId", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await patchCostCodeInput(
      active.id,
      req.params.developmentId,
      req.params.periodId,
      req.params.inputId,
      body,
      { actor: provisionalActor(body) }
    );
    sendResult(res, result, 200, "input");
  } catch (err) {
    console.error("[CVR] patch input error:", err);
    res.status(500).json({ message: "Failed to update CVR cost-code input." });
  }
});

/**
 * BL-033D.x.4C.1 — Atomic Prelims → Draft CVR adoption command.
 * No client UI trigger in this slice.
 */
router.post("/cvr/periods/:periodId/prelims-adoption", async (req, res) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ message: "Database not configured" });
    }
    const active = await getActiveClient();
    if (!active) return res.status(404).json({ error: "No active client set" });

    const body = req.body || {};
    const result = await adoptPrelimsForecasts(
      active.id,
      req.params.developmentId,
      req.params.periodId,
      body,
      { actor: provisionalActor(body) }
    );
    sendResult(res, result, 200, "adoption");
  } catch (err) {
    console.error("[CVR] prelims adoption error:", err);
    res.status(500).json({ message: "Failed to adopt Prelims forecasts into CVR." });
  }
});

module.exports = router;
