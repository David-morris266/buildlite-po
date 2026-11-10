import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPackageVariationAccount } from './variationAccounts';

describe('Variation Account package projection API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the server VA evidence identity consumed by the package register', async () => {
    const response = {
      items: [{ id: 'va-stable-id', reference: 'VA-0001' }],
      packageExposure: {
        ready: true,
        unresolvedExposure: 10000,
        evidence: [{ variationAccountItemId: 'va-stable-id', commercialEventId: 'ce-1', linked: true, resultingExposure: 10000 }],
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(loadPackageVariationAccount('package-1')).resolves.toEqual(response);
  });
});
