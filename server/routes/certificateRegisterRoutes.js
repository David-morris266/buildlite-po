const express = require('express');
const { requirePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const { getCertificateRegister } = require('../services/certificateRegisterService');

const router = express.Router();
router.get('/', requirePermission(PERMISSIONS.COMMERCIAL_READ), async (req, res, next) => {
  try { res.json(await getCertificateRegister(req.buildliteAuth, req.query)); }
  catch (error) { next(error); }
});
module.exports = router;
