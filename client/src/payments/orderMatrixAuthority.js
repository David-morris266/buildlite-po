/**
 * BL-029D — Order Matrix server authority feature flag.
 *
 * Default OFF: localStorage remains runtime matrix authority.
 * When true: reads use the server cache; imports/saves PUT to Postgres.
 */

export function isOrderMatrixServerAuthorityEnabled() {
  return String(import.meta.env.VITE_MATRIX_SERVER_AUTHORITY || '').toLowerCase() === 'true';
}
