/**
 * BL-031B/D — Purchase ledger server authority feature flag.
 *
 * Default OFF: localStorage (buildlite_purchase_ledgers_v1) remains runtime authority.
 * When true: ledger reads and import/reversal mutations use the server cache/API only.
 * No localStorage fallback and no dual-write.
 */

export function isLedgerServerAuthorityEnabled() {
  return String(import.meta.env.VITE_LEDGER_SERVER_AUTHORITY || '').toLowerCase() === 'true';
}
