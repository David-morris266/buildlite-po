/**
 * BL-030B — Payment Certificate server authority feature flag.
 *
 * Default OFF: localStorage (paymentCertificateStore) remains runtime authority.
 * When true in tests: reads use the server cache with no localStorage fallback.
 * Live writes stay localStorage until BL-030C.
 */

export function isPaymentCertificateServerAuthorityEnabled() {
  return (
    String(import.meta.env.VITE_CERTIFICATE_SERVER_AUTHORITY || '').toLowerCase() ===
    'true'
  );
}
