/**
 * BL-033D.x.2A.1 — Cost Code Master server authority feature flag.
 *
 * Default OFF: browser localStorage (buildlite_cost_codes_master_v1) remains
 * the live Admin Cost Code Master.
 * When true: reads/writes use the server cache/API only.
 * No localStorage fallback and no dual-write.
 */

export function isCostCodeServerAuthorityEnabled() {
  return String(import.meta.env.VITE_COST_CODE_SERVER_AUTHORITY || '').toLowerCase() === 'true';
}
