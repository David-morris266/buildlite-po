const { performance } = require('node:perf_hooks');

const ALLOWED_EVENTS = new Set([
  'server_clerk_middleware',
  'server_principal_resolution',
  'server_tenant_readiness',
  'server_auth_me_total',
]);

function timingStart() { return performance.now(); }
function recordTiming(event, startedAt) {
  if (!ALLOWED_EVENTS.has(event)) return;
  const durationMs = Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10);
  console.info('[buildlite-timing]', { event, durationMs });
}

module.exports = { timingStart, recordTiming };
