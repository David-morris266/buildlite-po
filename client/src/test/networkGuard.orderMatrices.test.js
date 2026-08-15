/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installNetworkGuard } from './networkGuard';
import { listMatricesForDevelopment } from '../api/orderMatrices';

describe('networkGuard order matrix API', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
  });

  afterEach(() => {
    networkGuard?.restore();
  });

  it('prevents client tests from fetching live localhost:3001 matrix routes', async () => {
    await expect(listMatricesForDevelopment('dev-guard')).rejects.toThrow(
      /NETWORK GUARD: blocked fetch to live API/
    );
    expect(networkGuard.getAttempts().some((url) => url.includes('/matrices'))).toBe(true);
  });
});
