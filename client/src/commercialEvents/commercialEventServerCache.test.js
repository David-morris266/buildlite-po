import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/commercialEvents', () => import('../test/mockCommercialEventApi'));

import {
  buildApprovedVariationFixture,
  getCommercialEventListCallCount,
  resetCommercialEventApiStore,
  setCommercialEventListDelay,
  setCommercialEventListReject,
  CommercialEventApiError,
} from '../test/mockCommercialEventApi';
import {
  __resetCommercialEventServerCacheForTests,
  ensureCommercialEventsReadyForDevelopment,
  getCachedCommercialEventById,
  getCommercialEventsLoadError,
  getCommercialEventsLoadState,
  listCachedCommercialEventsByDevelopment,
  listCachedCommercialEventsByPackage,
  refreshCommercialEventsForDevelopment,
} from './commercialEventServerCache';
import { listCommercialEventsByPackage } from './commercialEventStore';

const DEV_A = 'dev-cache-a';
const DEV_B = 'dev-cache-b';
const ORDER_KEY = `${DEV_A}::sup-1::0120`;

describe('commercialEventServerCache', () => {
  beforeEach(() => {
    __resetCommercialEventServerCacheForTests();
    resetCommercialEventApiStore();
  });

  it('hydrates successfully and exposes synchronous selectors', async () => {
    const fixture = buildApprovedVariationFixture({
      developmentId: DEV_A,
      orderKey: ORDER_KEY,
      value: 20000,
    });

    await ensureCommercialEventsReadyForDevelopment(DEV_A);

    expect(getCommercialEventsLoadState(DEV_A)).toBe('loaded');
    expect(listCachedCommercialEventsByDevelopment(DEV_A)).toHaveLength(1);
    expect(listCachedCommercialEventsByPackage(DEV_A, ORDER_KEY)).toHaveLength(1);
    expect(getCachedCommercialEventById(DEV_A, fixture.id)?.value).toBe(20000);
  });

  it('handles empty hydration result', async () => {
    await ensureCommercialEventsReadyForDevelopment(DEV_A);
    expect(getCommercialEventsLoadState(DEV_A)).toBe('loaded');
    expect(listCachedCommercialEventsByDevelopment(DEV_A)).toEqual([]);
  });

  it('sets error state and throws on API failure without localStorage fallback', async () => {
    setCommercialEventListReject(
      new CommercialEventApiError('Commercial Events unavailable', {
        status: 500,
        body: { message: 'Commercial Events unavailable' },
      })
    );

    await expect(ensureCommercialEventsReadyForDevelopment(DEV_A)).rejects.toThrow(
      'Commercial Events unavailable'
    );

    expect(getCommercialEventsLoadState(DEV_A)).toBe('error');
    expect(getCommercialEventsLoadError(DEV_A)?.message).toContain('Commercial Events unavailable');
    expect(listCachedCommercialEventsByDevelopment(DEV_A)).toEqual([]);
    expect(listCommercialEventsByPackage(DEV_A, ORDER_KEY)).toEqual([]);
  });

  it('deduplicates concurrent hydration for the same development', async () => {
    setCommercialEventListDelay(50);
    buildApprovedVariationFixture({ developmentId: DEV_A, orderKey: ORDER_KEY });

    const first = ensureCommercialEventsReadyForDevelopment(DEV_A);
    const second = ensureCommercialEventsReadyForDevelopment(DEV_A);

    await Promise.all([first, second]);

    expect(getCommercialEventListCallCount()).toBe(1);

    expect(getCommercialEventsLoadState(DEV_A)).toBe('loaded');
    expect(listCachedCommercialEventsByDevelopment(DEV_A)).toHaveLength(1);
  });

  it('refresh replaces cache contents', async () => {
    buildApprovedVariationFixture({
      id: 'ce-first',
      developmentId: DEV_A,
      orderKey: ORDER_KEY,
      value: 1000,
    });

    await ensureCommercialEventsReadyForDevelopment(DEV_A);
    expect(listCachedCommercialEventsByDevelopment(DEV_A)).toHaveLength(1);

    resetCommercialEventApiStore();
    buildApprovedVariationFixture({
      id: 'ce-second',
      developmentId: DEV_A,
      orderKey: ORDER_KEY,
      value: 5000,
    });

    await refreshCommercialEventsForDevelopment(DEV_A);

    const events = listCachedCommercialEventsByDevelopment(DEV_A);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('ce-second');
    expect(events[0].value).toBe(5000);
  });

  it('keeps separate development caches isolated', async () => {
    buildApprovedVariationFixture({
      id: 'ce-dev-a',
      developmentId: DEV_A,
      orderKey: ORDER_KEY,
    });
    buildApprovedVariationFixture({
      id: 'ce-dev-b',
      developmentId: DEV_B,
      orderKey: `${DEV_B}::sup-1::0120`,
    });

    await Promise.all([
      ensureCommercialEventsReadyForDevelopment(DEV_A),
      ensureCommercialEventsReadyForDevelopment(DEV_B),
    ]);

    expect(listCachedCommercialEventsByDevelopment(DEV_A)).toHaveLength(1);
    expect(listCachedCommercialEventsByDevelopment(DEV_B)).toHaveLength(1);
    expect(listCachedCommercialEventsByDevelopment(DEV_A)[0].id).toBe('ce-dev-a');
    expect(listCachedCommercialEventsByDevelopment(DEV_B)[0].id).toBe('ce-dev-b');
  });
});
