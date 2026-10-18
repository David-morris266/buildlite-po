const express = require('express');
const { getHomeDashboard } = require('../services/homeDashboardService');
const { requireAuthenticated } = require('../auth/authorization');

const router = express.Router();

router.get('/dashboard', requireAuthenticated, async (request, response, next) => {
  try { response.json(await getHomeDashboard(request.buildliteAuth)); }
  catch (error) { next(error); }
});

module.exports = router;
