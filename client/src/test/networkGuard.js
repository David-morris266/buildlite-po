/**
 * BL-028B.3b — Fail closed if client tests attempt live API calls.
 */
import { vi } from 'vitest';

export const LIVE_API_HOSTS = ['localhost:3001', '127.0.0.1:3001'];

function resolveFetchUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input.url === 'string') return input.url;
  return String(input);
}

export function isLiveApiUrl(url) {
  const normalized = String(url || '');
  return LIVE_API_HOSTS.some((host) => normalized.includes(host));
}

/**
 * Stub global fetch to throw on any request to the live dev/UAT API.
 * @returns {{ getAttempts: () => string[], assertNoLiveApiCalls: () => void, restore: () => void }}
 */
export function installNetworkGuard() {
  const attempts = [];
  const originalFetch = globalThis.fetch?.bind(globalThis);

  const guardedFetch = vi.fn(async (input, init) => {
    const url = resolveFetchUrl(input);
    attempts.push(url);
    if (isLiveApiUrl(url)) {
      throw new Error(
        `NETWORK GUARD: blocked fetch to live API (${url}). Client tests must mock all server calls.`
      );
    }
    if (originalFetch) {
      return originalFetch(input, init);
    }
    throw new Error(`NETWORK GUARD: fetch called with no underlying implementation (${url})`);
  });

  vi.stubGlobal('fetch', guardedFetch);

  return {
    getAttempts: () => [...attempts],
    assertNoLiveApiCalls: () => {
      const live = attempts.filter(isLiveApiUrl);
      if (live.length) {
        throw new Error(`Live API calls detected: ${live.join(', ')}`);
      }
    },
    restore: () => {
      if (originalFetch) {
        vi.stubGlobal('fetch', originalFetch);
      } else {
        vi.unstubAllGlobals();
      }
    },
  };
}
