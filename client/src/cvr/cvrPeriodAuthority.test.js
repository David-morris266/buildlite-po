import { describe, expect, it } from 'vitest';
import { CVR_AUTHORITY_MODES, resolveCvrAuthorityMode } from './cvrPeriodAuthority';

describe('CVR authority mode', () => {
  it('requires server authority in a production build', () => {
    expect(resolveCvrAuthorityMode({ MODE: 'production', PROD: true })).toBe(
      CVR_AUTHORITY_MODES.INVALID_HOSTED
    );
    expect(resolveCvrAuthorityMode({ MODE: 'production', PROD: true, VITE_CVR_SERVER_AUTHORITY: 'false' })).toBe(
      CVR_AUTHORITY_MODES.INVALID_HOSTED
    );
    expect(resolveCvrAuthorityMode({ MODE: 'production', PROD: true, VITE_CVR_SERVER_AUTHORITY: 'true' })).toBe(
      CVR_AUTHORITY_MODES.SERVER
    );
  });

  it('retains explicit legacy-local behavior outside production', () => {
    expect(resolveCvrAuthorityMode({ MODE: 'test', PROD: false })).toBe(
      CVR_AUTHORITY_MODES.LEGACY_LOCAL
    );
    expect(resolveCvrAuthorityMode({ MODE: 'development', DEV: true })).toBe(
      CVR_AUTHORITY_MODES.LEGACY_LOCAL
    );
  });
});
