/**
 * Tenant-owned company Prelims templates API.
 * Reads require commercial access; company-template mutations require the
 * dedicated commercial template authority. Tenant and actor identity always
 * come from the authenticated membership.
 */

const express = require('express');
const { PERMISSIONS } = require('../auth/permissions');
const { actorFromAuth, requirePermission } = require('../auth/authorization');
const { getBuildLiteStandardPrelimsTemplate } = require('../services/buildliteStandardPrelimsTemplate');
const repository = require('../services/prelimsTemplateRepository');

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

function rejectProductStandardMutation(req, res) {
  if (String(req.params.templateId || '').toLowerCase() === 'standard') {
    res.status(405).json({ message: 'BuildLite Standard is product-owned and cannot be edited.' });
    return true;
  }
  return false;
}

function authenticatedWriteContext(req) {
  return {
    auth: req.buildliteAuth,
    ...actorFromAuth(req.buildliteAuth, PERMISSIONS.COMMERCIAL_TEMPLATES_MANAGE),
  };
}

function guarded(label, message, handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error(`[Prelims templates] ${label} error:`, error);
      if (!res.headersSent) res.status(500).json({ message });
    }
  };
}

router.get(
  '/standard',
  requirePermission(PERMISSIONS.COMMERCIAL_READ),
  guarded('STANDARD', 'Failed to load BuildLite Standard Prelims template.', async (_req, res) => {
    res.status(200).json(getBuildLiteStandardPrelimsTemplate());
  })
);

router.get(
  '/',
  requirePermission(PERMISSIONS.COMMERCIAL_READ),
  guarded('LIST', 'Failed to load company Prelims templates.', async (req, res) => {
    const result = await repository.listTemplates(req.buildliteAuth.clientId);
    if (!result.ok) return sendResult(res, result, 'templates');
    res.status(200).json({ templates: result.templates });
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.COMMERCIAL_TEMPLATES_MANAGE),
  guarded('CREATE', 'Failed to create company Prelims template.', async (req, res) => {
    const result = await repository.createTemplate(
      req.buildliteAuth.clientId,
      req.body || {},
      authenticatedWriteContext(req)
    );
    sendResult(res, result, 'template', 201);
  })
);

router.get(
  '/:templateId',
  requirePermission(PERMISSIONS.COMMERCIAL_READ),
  guarded('GET', 'Failed to load company Prelims template.', async (req, res) => {
    sendResult(
      res,
      await repository.getTemplate(req.buildliteAuth.clientId, req.params.templateId),
      'template'
    );
  })
);

router.put(
  '/:templateId',
  requirePermission(PERMISSIONS.COMMERCIAL_TEMPLATES_MANAGE),
  guarded('PUT', 'Failed to save company Prelims template.', async (req, res) => {
    if (rejectProductStandardMutation(req, res)) return;
    sendResult(
      res,
      await repository.updateTemplate(
        req.buildliteAuth.clientId,
        req.params.templateId,
        req.body || {},
        authenticatedWriteContext(req)
      ),
      'template'
    );
  })
);

router.post(
  '/:templateId/lines',
  requirePermission(PERMISSIONS.COMMERCIAL_TEMPLATES_MANAGE),
  guarded('LINE CREATE', 'Failed to create Prelims template line.', async (req, res) => {
    if (rejectProductStandardMutation(req, res)) return;
    sendResult(
      res,
      await repository.createTemplateLine(
        req.buildliteAuth.clientId,
        req.params.templateId,
        req.body || {},
        authenticatedWriteContext(req)
      ),
      'line',
      201
    );
  })
);

router.put(
  '/:templateId/lines/:lineId',
  requirePermission(PERMISSIONS.COMMERCIAL_TEMPLATES_MANAGE),
  guarded('LINE PUT', 'Failed to save Prelims template line.', async (req, res) => {
    if (rejectProductStandardMutation(req, res)) return;
    sendResult(
      res,
      await repository.updateTemplateLine(
        req.buildliteAuth.clientId,
        req.params.templateId,
        req.params.lineId,
        req.body || {},
        authenticatedWriteContext(req)
      ),
      'line'
    );
  })
);

module.exports = router;
