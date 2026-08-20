/**
 * BL-032A — Revenue settings server authority feature flag.
 *
 * Default OFF: localStorage (buildlite_revenue_v1) remains runtime authority
 * for development strategy/settings.
 * When true: strategy/settings reads and writes use the server cache/API only.
 * No localStorage fallback and no dual-write.
 * Plot Master commercial fields stay on developments.payload.
 */

export function isRevenueServerAuthorityEnabled() {
  return String(import.meta.env.VITE_REVENUE_SERVER_AUTHORITY || '').toLowerCase() === 'true';
}
