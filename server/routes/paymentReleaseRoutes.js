const express = require('express');
const repository = require('../services/paymentReleaseRepository');
const { requirePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');

const router = express.Router();
const clientId = request => request.buildliteAuth.clientId;

router.get('/queue', requirePermission(PERMISSIONS.PAYMENT_RELEASE_EXECUTE), async (request, response) => {
  try { response.json({ items: await repository.listQueue(clientId(request), request.buildliteAuth) }); }
  catch (error) { response.status(error.status || 500).json({ message: error.message || 'Failed to load Payment Release worklist.' }); }
});
router.post('/batches', requirePermission(PERMISSIONS.PAYMENT_RELEASE_EXECUTE), async (request, response) => {
  try {
    const result = await repository.executeBatch(clientId(request), request.body || {}, request.buildliteAuth);
    response.status(result.status).json(result.ok ? result : { message: result.message });
  } catch (error) { response.status(error.status || 500).json({ message: error.message || 'Failed to release authorised payments.' }); }
});

module.exports = router;
