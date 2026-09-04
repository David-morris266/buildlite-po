export function shouldEnterSetup({ routeView, tenantReadiness, setupDismissed = false } = {}) {
  if (setupDismissed) return false;
  if (routeView === 'setup') return true;
  return tenantReadiness?.configured !== true;
}
