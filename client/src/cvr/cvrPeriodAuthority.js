/**
 * BL-031B/D — CVR period server authority feature flag.
 *
 * Default OFF: localStorage (buildlite_cvr_v1) remains runtime authority.
 * When true: CVR reads and writes use the server cache/API only.
 * No localStorage fallback and no dual-write.
 */

export const CVR_AUTHORITY_MODES = Object.freeze({
  SERVER: 'server',
  LEGACY_LOCAL: 'legacy-local',
  INVALID_HOSTED: 'invalid-hosted',
});

export const CVR_AUTHORITY_CONFIGURATION_MESSAGE =
  'CVR server authority is not enabled for this BuildLite deployment.';

export function resolveCvrAuthorityMode(env = import.meta.env) {
  if (String(env?.VITE_CVR_SERVER_AUTHORITY || '').toLowerCase() === 'true') {
    return CVR_AUTHORITY_MODES.SERVER;
  }

  const hostedProduction = env?.PROD === true || String(env?.MODE || '').toLowerCase() === 'production';
  return hostedProduction
    ? CVR_AUTHORITY_MODES.INVALID_HOSTED
    : CVR_AUTHORITY_MODES.LEGACY_LOCAL;
}

export function getCvrAuthorityMode() {
  return resolveCvrAuthorityMode(import.meta.env);
}

export function isCvrServerAuthorityEnabled() {
  return getCvrAuthorityMode() === CVR_AUTHORITY_MODES.SERVER;
}

export function isCvrAuthorityConfigurationValid() {
  return getCvrAuthorityMode() !== CVR_AUTHORITY_MODES.INVALID_HOSTED;
}
