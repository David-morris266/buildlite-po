const express = require('express');
const { requirePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const branding = require('../services/tenantBranding');

const router = express.Router();
const manage = requirePermission(PERMISSIONS.COMPANY_SETTINGS_MANAGE);
const rawLogo = express.raw({ type: () => true, limit: branding.MAX_INPUT_BYTES });

router.get('/', async (req, res) => {
  try { return res.json(await branding.getState(req.buildliteAuth.clientId)); }
  catch (error) { return res.status(error.status || 500).json({ message: error.message || 'Failed to load Company branding.' }); }
});

router.get('/assets/:assetId', async (req, res) => {
  try {
    const asset = await branding.getAsset(req.buildliteAuth.clientId, req.params.assetId);
    if (!asset) return res.status(404).json({ message: 'Company logo not found.' });
    const etag = `"${asset.sha256}"`;
    if (req.get('If-None-Match') === etag) return res.status(304).end();
    res.set({ 'Content-Type': asset.mimeType, 'Content-Length': String(asset.binary.length), ETag: etag,
      'Cache-Control': 'private, max-age=3600, must-revalidate', 'X-Content-Type-Options': 'nosniff' });
    return res.end(asset.binary);
  } catch (error) { return res.status(error.status || 500).json({ message: error.message || 'Failed to load Company logo.' }); }
});

router.post('/logo', manage, rawLogo, async (req, res) => {
  try {
    const version = Number(req.get('X-BuildLite-Branding-Version'));
    if (!Number.isInteger(version) || version < 0) return res.status(400).json({ message: 'Current branding version is required.' });
    const result = await branding.upload(req.buildliteAuth.clientId, req.body, req.get('X-BuildLite-File-Name'), version, req.buildliteAuth);
    return result.ok === false ? res.status(result.status).json({ message: result.message }) : res.status(201).json({ version: result.version, logo: result.logo });
  } catch (error) { return res.status(error.status || 500).json({ message: error.message || 'Failed to save Company logo.' }); }
});

router.delete('/logo', manage, async (req, res) => {
  try {
    const version = Number(req.body?.version);
    if (!Number.isInteger(version) || version < 0) return res.status(400).json({ message: 'Current branding version is required.' });
    const result = await branding.remove(req.buildliteAuth.clientId, version, req.buildliteAuth);
    return result.ok === false ? res.status(result.status).json({ message: result.message }) : res.json({ version: result.version, logo: null });
  } catch (error) { return res.status(error.status || 500).json({ message: error.message || 'Failed to remove Company logo.' }); }
});

module.exports = router;
