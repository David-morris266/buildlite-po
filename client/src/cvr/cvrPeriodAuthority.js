/**
 * BL-031B/D — CVR period server authority feature flag.
 *
 * Default OFF: localStorage (buildlite_cvr_v1) remains runtime authority.
 * When true: CVR reads and writes use the server cache/API only.
 * No localStorage fallback and no dual-write.
 */

export function isCvrServerAuthorityEnabled() {
  return String(import.meta.env.VITE_CVR_SERVER_AUTHORITY || '').toLowerCase() === 'true';
}
