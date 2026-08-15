/**
 * BL-029B — Order Matrix server authority feature flag.
 *
 * Default OFF: localStorage remains runtime matrix authority (orderMatrixStore).
 * When enabled later (BL-029D): server cache becomes read authority.
 */

export function isOrderMatrixServerAuthorityEnabled() {
  return String(import.meta.env.VITE_MATRIX_SERVER_AUTHORITY || '').toLowerCase() === 'true';
}
