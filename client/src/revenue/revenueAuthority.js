/**
 * BL-032A — Revenue settings server authority feature flag.
 *
 * Normal development/pilot/production operation is server-authoritative.
 * Unit tests may explicitly exercise the retired browser-local adapter.
 * No localStorage fallback and no dual-write.
 * Plot Master commercial fields stay on developments.payload.
 */

export function isRevenueServerAuthorityEnabled() {
  if (import.meta.env.MODE === 'test') {
    return String(import.meta.env.VITE_REVENUE_SERVER_AUTHORITY || '').toLowerCase() === 'true';
  }
  return true;
}
