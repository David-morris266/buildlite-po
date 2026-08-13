/**
 * BL-028B.1 — Commercial Event server authority feature flag.
 *
 * Default OFF: localStorage remains runtime CE authority (commercialEventStore).
 * When enabled (BL-028B.3 cutover): server cache becomes financial/read authority.
 */

export function isCommercialEventServerAuthorityEnabled() {
  return String(import.meta.env.VITE_CE_SERVER_AUTHORITY || '').toLowerCase() === 'true';
}

/**
 * Whether synchronous financial helpers may use CE data for a development.
 */
export function canUseCommercialEventsForFinancials(developmentId) {
  if (!isCommercialEventServerAuthorityEnabled()) {
    return true;
  }
  if (!developmentId) return false;
  // Lazy import avoided — callers should use getCommercialEventFinancialReadiness
  return false;
}
