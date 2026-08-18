import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';
import { CvrPeriodApiError, listCvrPeriodInputs, listCvrPeriodsForDevelopment } from './cvrPeriods';

describe('cvrPeriods API wrapper (BL-031B)', () => {
  let networkGuard;

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
    vi.unstubAllGlobals();
  });

  it('maps period list responses from arrays and { periods }', async () => {
    networkGuard = installNetworkGuard();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        expect(String(url)).toContain('/api/developments/dev-1/cvr/periods');
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ periods: [{ id: 'p1', periodKey: 'P01' }] }),
        };
      })
    );

    const listed = await listCvrPeriodsForDevelopment('dev-1');
    expect(listed).toEqual([{ id: 'p1', periodKey: 'P01' }]);
  });

  it('maps input list responses', async () => {
    networkGuard = installNetworkGuard();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ inputs: [{ id: 'i1', costCodeKey: '5231', manualAccrual: 400 }] }),
      }))
    );

    const listed = await listCvrPeriodInputs('dev-1', 'p1');
    expect(listed).toEqual([{ id: 'i1', costCodeKey: '5231', manualAccrual: 400 }]);
  });

  it('throws structured CvrPeriodApiError on failure', async () => {
    networkGuard = installNetworkGuard();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () => JSON.stringify({ message: 'CVR periods unavailable' }),
      }))
    );

    await expect(listCvrPeriodsForDevelopment('dev-1')).rejects.toMatchObject({
      name: 'CvrPeriodApiError',
      status: 500,
      message: 'CVR periods unavailable',
    });
    expect(CvrPeriodApiError.name).toBe('CvrPeriodApiError');
  });
});
