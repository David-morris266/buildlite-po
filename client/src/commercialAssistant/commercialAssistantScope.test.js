import { describe, expect, it } from 'vitest';
import { isEmptyScope, normalizeScope, scopesEqual } from './commercialAssistantScope';

describe('commercialAssistantScope helpers', () => {
  it('treats equivalent scopes as equal', () => {
    const packages = [{ orderKey: 'dev::sup-1::0100' }];
    const onNavigate = () => {};

    expect(
      scopesEqual(
        { developmentId: 'dev-1', packages, onNavigate },
        { developmentId: 'dev-1', packages, onNavigate }
      )
    ).toBe(true);
  });

  it('detects genuine development scope changes', () => {
    const packages = [{ orderKey: 'pkg-1' }];

    expect(
      scopesEqual(
        { developmentId: 'dev-1', packages, onNavigate: null },
        { developmentId: 'dev-2', packages, onNavigate: null }
      )
    ).toBe(false);
  });

  it('detects package reference changes', () => {
    expect(
      scopesEqual(
        { developmentId: 'dev-1', packages: [{ orderKey: 'a' }], onNavigate: null },
        { developmentId: 'dev-1', packages: [{ orderKey: 'a' }], onNavigate: null }
      )
    ).toBe(false);
  });

  it('normalizes empty scope values', () => {
    expect(normalizeScope(null)).toEqual({
      developmentId: null,
      packages: [],
      onNavigate: null,
    });
    expect(isEmptyScope({ developmentId: null, packages: [], onNavigate: null })).toBe(true);
  });
});
