import { describe, expect, it } from 'vitest';
import { COST_CODE_AUTHORITY_MODES, resolveCostCodeAuthority } from './costCodeAuthority';

describe('GP-5A.1 Cost Code Master authority contract', () => {
  it('defaults normal development and production operation to server authority', () => {
    expect(resolveCostCodeAuthority({ MODE: 'development', DEV: true })).toBe(COST_CODE_AUTHORITY_MODES.server);
    expect(resolveCostCodeAuthority({ MODE: 'production', PROD: true })).toBe(COST_CODE_AUTHORITY_MODES.server);
  });

  it('does not let the missing or false former flag select browser authority', () => {
    expect(resolveCostCodeAuthority({ MODE: 'production', PROD: true, VITE_COST_CODE_SERVER_AUTHORITY: 'false' })).toBe(COST_CODE_AUTHORITY_MODES.server);
    expect(resolveCostCodeAuthority({ MODE: 'development', DEV: true, VITE_COST_CODE_SERVER_AUTHORITY: 'false' })).toBe(COST_CODE_AUTHORITY_MODES.server);
  });

  it('permits explicit legacy-local authority only outside production', () => {
    expect(resolveCostCodeAuthority({ MODE: 'test', VITE_COST_CODE_AUTHORITY_MODE: 'legacy-local' })).toBe(COST_CODE_AUTHORITY_MODES.legacyLocal);
    expect(resolveCostCodeAuthority({ MODE: 'development', DEV: true, VITE_COST_CODE_AUTHORITY_MODE: 'legacy-local' })).toBe(COST_CODE_AUTHORITY_MODES.legacyLocal);
    expect(resolveCostCodeAuthority({ MODE: 'production', PROD: true, VITE_COST_CODE_AUTHORITY_MODE: 'legacy-local' })).toBe(COST_CODE_AUTHORITY_MODES.server);
  });

  it('ignores unknown authority modes and fails closed to server', () => {
    expect(resolveCostCodeAuthority({ MODE: 'development', VITE_COST_CODE_AUTHORITY_MODE: 'browser' })).toBe(COST_CODE_AUTHORITY_MODES.server);
  });
});
