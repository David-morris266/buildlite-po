const express = require('express');
const { getTenantReadiness } = require('../services/tenantReadiness');
const router = express.Router();
router.get('/readiness', async (req, res) => {
  try {
    const tenantReadiness = await getTenantReadiness(req.buildliteAuth.clientId);
    res.json({ clientId: req.buildliteAuth.clientId, tenantReadiness });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Could not determine tenant readiness.' });
  }
});
router.get('/me', async (req, res) => {
  try {
    const tenantReadiness = await getTenantReadiness(req.buildliteAuth.clientId);
    res.json({
      user: { id: req.buildliteAuth.userId, displayName: req.buildliteAuth.displayName, email: req.buildliteAuth.email },
      activeTenant: { clientId: req.buildliteAuth.clientId, membershipId: req.buildliteAuth.membershipId, roleKey: req.buildliteAuth.roleKey, roleName: req.buildliteAuth.roleName,
        membershipVersion:req.buildliteAuth.membershipVersion,capabilityKeys:req.buildliteAuth.capabilityKeys||[],code: tenantReadiness.tenant?.code || null, name: tenantReadiness.tenant?.name || null },
      permissions: req.buildliteAuth.permissions || [], platformPermissions:req.buildliteAuth.platformPermissions||[], memberships: req.buildliteAuth.memberships || [],
      tenantReadiness,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Could not determine tenant readiness.' });
  }
});
module.exports = router;
