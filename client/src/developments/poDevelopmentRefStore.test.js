/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  savePoDevelopmentRef,
  getPoDevelopmentRefByNumber,
} from './poDevelopmentRefStore';

describe('tenant-scoped PO development reference fallback', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the same displayed PO number isolated between companies', () => {
    localStorage.setItem('buildlite_active_client_id', 'tenant-a');
    savePoDevelopmentRef('M0001', { developmentId: 'dev-a' });
    localStorage.setItem('buildlite_active_client_id', 'tenant-b');
    savePoDevelopmentRef('M0001', { developmentId: 'dev-b' });

    expect(getPoDevelopmentRefByNumber('M0001')).toMatchObject({ developmentId: 'dev-b' });
    localStorage.setItem('buildlite_active_client_id', 'tenant-a');
    expect(getPoDevelopmentRefByNumber('M0001')).toMatchObject({ developmentId: 'dev-a' });
  });

  it('does not expose a legacy number-only reference after tenant selection', () => {
    localStorage.setItem('buildlite_po_development_refs_v1', JSON.stringify({
      M0001: { developmentId: 'legacy-other-tenant' },
    }));
    localStorage.setItem('buildlite_active_client_id', 'tenant-a');
    expect(getPoDevelopmentRefByNumber('M0001')).toBeNull();
  });
});
