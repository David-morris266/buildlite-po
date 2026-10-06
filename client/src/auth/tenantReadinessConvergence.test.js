import { describe, expect, it, vi } from 'vitest';
import { convergeTenantReadinessAfterMutation, costCodeMutationAffectsTenantReadiness } from './tenantReadinessConvergence';

describe('tenant readiness mutation convergence', () => {
  it('marks stale, refreshes workflow authority, then converges readiness once', async () => {
    const calls = [];
    const principal = {
      markTenantReadinessStale: vi.fn(() => calls.push('stale')),
      refreshTenantReadiness: vi.fn(async () => calls.push('readiness')),
    };
    const result = await convergeTenantReadinessAfterMutation(principal, {
      refreshAuthority: async () => { calls.push('authority'); return 'fresh authority'; },
    });
    expect(calls).toEqual(['stale', 'authority', 'readiness']);
    expect(result).toMatchObject({ authorityResult: 'fresh authority', authorityError: null, readinessRefreshed: true, readinessError: null });
    expect(principal.refreshTenantReadiness).toHaveBeenCalledOnce();
  });

  it('keeps readiness stale when the post-commit readiness refresh fails', async () => {
    const principal = {
      markTenantReadinessStale: vi.fn(),
      refreshTenantReadiness: vi.fn().mockRejectedValue(new Error('Readiness unavailable')),
    };
    const result = await convergeTenantReadinessAfterMutation(principal);
    expect(result.readinessRefreshed).toBe(false);
    expect(result.readinessError.message).toBe('Readiness unavailable');
    expect(principal.markTenantReadinessStale).toHaveBeenCalledTimes(2);
  });

  it('still attempts readiness convergence when workflow-specific refresh fails', async () => {
    const principal = { markTenantReadinessStale: vi.fn(), refreshTenantReadiness: vi.fn().mockResolvedValue({}) };
    const result = await convergeTenantReadinessAfterMutation(principal, {
      refreshAuthority: async () => { throw new Error('Cost Codes unavailable'); },
    });
    expect(result.authorityError.message).toBe('Cost Codes unavailable');
    expect(principal.refreshTenantReadiness).toHaveBeenCalledOnce();
    expect(result.readinessRefreshed).toBe(true);
  });

  it('limits Cost Code convergence to creation, active state and hierarchy authority', () => {
    expect(costCodeMutationAffectsTenantReadiness({ isNew: true })).toBe(true);
    expect(costCodeMutationAffectsTenantReadiness({ previous: { active: true }, next: { active: false } })).toBe(true);
    expect(costCodeMutationAffectsTenantReadiness({ previous: { active: true, commercialHeadId: null }, next: { active: true, commercialHeadId: 'head' } })).toBe(true);
    expect(costCodeMutationAffectsTenantReadiness({ previous: { active: true, notes: '' }, next: { active: true, notes: 'Updated' } })).toBe(false);
  });
});
