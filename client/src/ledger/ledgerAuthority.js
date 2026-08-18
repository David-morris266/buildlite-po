/**
 * BL-031B — Purchase ledger server authority feature flag.
 *
 * Default OFF: localStorage (buildlite_purchase_ledgers_v1) remains runtime authority.
 * When true: ledger reads use the server cache only. No localStorage fallback.
 * Import/reversal remain local until BL-031D. BL-031C mutation facades are unwired.
 */

export function isLedgerServerAuthorityEnabled() {
  return String(import.meta.env.VITE_LEDGER_SERVER_AUTHORITY || '').toLowerCase() === 'true';
}
