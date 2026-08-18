/**
 * BL-030B / BL-030C — Payment Certificate server authority feature flag.
 *
 * Default OFF: localStorage (paymentCertificateStore) remains runtime authority.
 * When true: V1 certificate reads and writes use the server cache/API only.
 * There is no mixed runtime and no localStorage certificate fallback.
 */

export function isPaymentCertificateServerAuthorityEnabled() {
  return (
    String(import.meta.env.VITE_CERTIFICATE_SERVER_AUTHORITY || '').toLowerCase() ===
    'true'
  );
}
