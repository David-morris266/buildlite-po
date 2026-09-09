/** GP-5A.1 Cost Code Master authority contract. */
export const COST_CODE_AUTHORITY_MODES = Object.freeze({
  server: 'server',
  legacyLocal: 'legacy-local',
});

export function resolveCostCodeAuthority(env = import.meta.env) {
  const mode = String(env?.MODE || '').trim().toLowerCase();
  const requested = String(env?.VITE_COST_CODE_AUTHORITY_MODE || '').trim().toLowerCase();
  const production = Boolean(env?.PROD) || mode === 'production';
  return !production && requested === COST_CODE_AUTHORITY_MODES.legacyLocal
    ? COST_CODE_AUTHORITY_MODES.legacyLocal
    : COST_CODE_AUTHORITY_MODES.server;
}

export function isCostCodeServerAuthorityEnabled() {
  return resolveCostCodeAuthority() === COST_CODE_AUTHORITY_MODES.server;
}

export function isLegacyLocalCostCodeAuthorityEnabled() {
  return resolveCostCodeAuthority() === COST_CODE_AUTHORITY_MODES.legacyLocal;
}
