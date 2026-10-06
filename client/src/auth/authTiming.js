const bootStartedAt = globalThis.performance?.now?.() ?? Date.now();

const ALLOWED_EVENTS = new Set([
  'clerk_signed_in_boundary',
  'authenticated_fetch_bridge_ready',
  'clerk_token_acquisition',
  'auth_me_request',
  'principal_established',
  'readiness_refresh',
]);

const now = () => globalThis.performance?.now?.() ?? Date.now();

export function timingStart() {
  return now();
}

export function recordAuthTiming(event, startedAt = bootStartedAt) {
  if (!ALLOWED_EVENTS.has(event)) return;
  const durationMs = Math.max(0, Math.round((now() - startedAt) * 10) / 10);
  console.info('[buildlite-timing]', { event, durationMs });
}
