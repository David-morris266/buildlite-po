export function shouldEnterCompanyReadiness({ routeView, tenantReadiness } = {}) {
  if (routeView !== 'home' && routeView !== 'setup') return false;
  return tenantReadiness?.configured === false;
}
