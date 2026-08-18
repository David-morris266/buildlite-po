/**
 * BL-031B — CVR period server authority feature flag.
 *
 * Default OFF: localStorage (buildlite_cvr_v1) remains runtime authority.
 * When true: CVR reads use the server cache only. No localStorage fallback.
 * Writes remain local until BL-031C.
 */

export function isCvrServerAuthorityEnabled() {
  return String(import.meta.env.VITE_CVR_SERVER_AUTHORITY || '').toLowerCase() === 'true';
}
