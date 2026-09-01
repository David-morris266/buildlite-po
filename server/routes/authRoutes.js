const express = require('express');
const router = express.Router();
router.get('/me', (req, res) => res.json({
  user: { id: req.buildliteAuth.userId, displayName: req.buildliteAuth.displayName, email: req.buildliteAuth.email },
  activeTenant: { clientId: req.buildliteAuth.clientId, membershipId: req.buildliteAuth.membershipId, roleKey: req.buildliteAuth.roleKey, roleName: req.buildliteAuth.roleName },
  permissions: req.buildliteAuth.permissions || [], memberships: req.buildliteAuth.memberships || [],
}));
module.exports = router;
