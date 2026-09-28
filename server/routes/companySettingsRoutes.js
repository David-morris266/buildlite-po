const express = require('express');
const db = require('../db');
const { requirePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const { DEFAULTS } = require('../services/tenantProvisioning');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const row = (await db.query('SELECT c.name,s.settings,s.version FROM clients c LEFT JOIN tenant_company_settings s ON s.client_id=c.id WHERE c.id=$1', [req.buildliteAuth.clientId])).rows[0];
    if (!row) return res.status(404).json({ message: 'Company not found.' });
    return res.json({ settings: { ...DEFAULTS, ...(row.settings || {}), companyName: row.name }, version: row.version || 0 });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load Company settings.' });
  }
});

router.put('/', requirePermission(PERMISSIONS.COMPANY_SETTINGS_MANAGE), async (req, res) => {
  try {
    const version = Number(req.body?.version);
    const supplied = req.body?.settings;
    if (!supplied || !Number.isInteger(version) || version < 0) return res.status(400).json({ message: 'Current version and Company settings are required.' });
    const company = (await db.query('SELECT name FROM clients WHERE id=$1', [req.buildliteAuth.clientId])).rows[0];
    if (!company) return res.status(404).json({ message: 'Company not found.' });
    const settings = { ...supplied, companyName: company.name };
    const actor = [req.buildliteAuth.userId, req.buildliteAuth.membershipId, req.buildliteAuth.providerUserId, req.buildliteAuth.displayName];
    let result;
    if (version === 0) {
      result = await db.query('INSERT INTO tenant_company_settings(client_id,settings,updated_by_user_id,updated_by_membership_id,updated_by_provider_user_id,updated_by_display_name) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING settings,version', [req.buildliteAuth.clientId, settings, ...actor]);
    } else {
      result = await db.query('UPDATE tenant_company_settings SET settings=$3,version=version+1,updated_at=NOW(),updated_by_user_id=$4,updated_by_membership_id=$5,updated_by_provider_user_id=$6,updated_by_display_name=$7 WHERE client_id=$1 AND version=$2 RETURNING settings,version', [req.buildliteAuth.clientId, version, settings, ...actor]);
    }
    if (!result.rows[0]) return res.status(409).json({ message: 'Company settings changed. Reload and try again.' });
    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to save Company settings.' });
  }
});

module.exports = router;
