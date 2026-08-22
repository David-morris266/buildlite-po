/**
 * BL-033D.x.2 — Company Prelims templates API
 * GET  /api/prelims-templates/standard   (product Standard, GET-only)
 * GET  /api/prelims-templates
 * POST /api/prelims-templates
 * GET  /api/prelims-templates/:templateId
 * PUT  /api/prelims-templates/:templateId
 * POST /api/prelims-templates/:templateId/lines
 * PUT  /api/prelims-templates/:templateId/lines/:lineId
 *
 * Product Standard cannot be mutated. Mapping persists cost_code_key only.
 */

const express = require("express");
const { isDbConfigured } = require("../db");
const { getActiveClient } = require("../services/activeClient");
const {
  getBuildLiteStandardPrelimsTemplate,
} = require("../services/buildliteStandardPrelimsTemplate");
const {
  createTemplate,
  createTemplateLine,
  getTemplate,
  listTemplates,
  provisionalActor,
  updateTemplate,
  updateTemplateLine,
} = require("../services/prelimsTemplateRepository");

const router = express.Router();

function sendResult(res, result, successKey, successStatus = 200) {
  if (!result.ok) {
    const payload = { message: result.message };
    if (result.errors) payload.errors = result.errors;
    if (result.template) payload.template = result.template;
    if (result.line) payload.line = result.line;
    return res.status(result.status || 400).json(payload);
  }
  return res.status(result.status || successStatus).json(result[successKey]);
}

async function withActiveClient(req, res) {
  if (!isDbConfigured()) {
    res.status(500).json({ message: "Database not configured" });
    return null;
  }
  const active = await getActiveClient();
  if (!active) {
    res.status(404).json({ error: "No active client set" });
    return null;
  }
  return active;
}

function rejectProductStandardMutation(req, res) {
  if (String(req.params.templateId || "").toLowerCase() === "standard") {
    res.status(405).json({
      message: "BuildLite Standard is product-owned and cannot be edited.",
    });
    return true;
  }
  return false;
}

router.get("/standard", async (req, res) => {
  try {
    const active = await withActiveClient(req, res);
    if (!active) return;
    res.status(200).json(getBuildLiteStandardPrelimsTemplate());
  } catch (err) {
    console.error("[Prelims templates] STANDARD error:", err);
    res.status(500).json({ message: "Failed to load BuildLite Standard Prelims template." });
  }
});

router.get("/", async (req, res) => {
  try {
    const active = await withActiveClient(req, res);
    if (!active) return;
    const result = await listTemplates(active.id);
    if (!result.ok) return sendResult(res, result, "templates");
    res.status(200).json({ templates: result.templates });
  } catch (err) {
    console.error("[Prelims templates] LIST error:", err);
    res.status(500).json({ message: "Failed to load company Prelims templates." });
  }
});

router.post("/", async (req, res) => {
  try {
    const active = await withActiveClient(req, res);
    if (!active) return;
    const body = req.body || {};
    const result = await createTemplate(active.id, body, { actor: provisionalActor(body) });
    sendResult(res, result, "template", 201);
  } catch (err) {
    console.error("[Prelims templates] CREATE error:", err);
    res.status(500).json({ message: "Failed to create company Prelims template." });
  }
});

router.get("/:templateId", async (req, res) => {
  try {
    const active = await withActiveClient(req, res);
    if (!active) return;
    const result = await getTemplate(active.id, req.params.templateId);
    sendResult(res, result, "template");
  } catch (err) {
    console.error("[Prelims templates] GET error:", err);
    res.status(500).json({ message: "Failed to load company Prelims template." });
  }
});

router.put("/:templateId", async (req, res) => {
  try {
    if (rejectProductStandardMutation(req, res)) return;
    const active = await withActiveClient(req, res);
    if (!active) return;
    const body = req.body || {};
    const result = await updateTemplate(active.id, req.params.templateId, body, {
      actor: provisionalActor(body),
    });
    sendResult(res, result, "template");
  } catch (err) {
    console.error("[Prelims templates] PUT error:", err);
    res.status(500).json({ message: "Failed to save company Prelims template." });
  }
});

router.post("/:templateId/lines", async (req, res) => {
  try {
    if (rejectProductStandardMutation(req, res)) return;
    const active = await withActiveClient(req, res);
    if (!active) return;
    const body = req.body || {};
    const result = await createTemplateLine(active.id, req.params.templateId, body, {
      actor: provisionalActor(body),
    });
    sendResult(res, result, "line", 201);
  } catch (err) {
    console.error("[Prelims templates] LINE CREATE error:", err);
    res.status(500).json({ message: "Failed to create Prelims template line." });
  }
});

router.put("/:templateId/lines/:lineId", async (req, res) => {
  try {
    if (rejectProductStandardMutation(req, res)) return;
    const active = await withActiveClient(req, res);
    if (!active) return;
    const body = req.body || {};
    const result = await updateTemplateLine(
      active.id,
      req.params.templateId,
      req.params.lineId,
      body,
      { actor: provisionalActor(body) }
    );
    sendResult(res, result, "line");
  } catch (err) {
    console.error("[Prelims templates] LINE PUT error:", err);
    res.status(500).json({ message: "Failed to save Prelims template line." });
  }
});

module.exports = router;
