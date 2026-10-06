import { afterEach, expect, it, vi } from 'vitest';
import { recordAuthTiming, timingStart } from './authTiming';

afterEach(() => vi.restoreAllMocks());

it('emits duration-only allowlisted authentication timing evidence', () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  recordAuthTiming('auth_me_request', timingStart());
  recordAuthTiming('provider-user-secret', timingStart());
  expect(info).toHaveBeenCalledTimes(1);
  expect(info.mock.calls[0][0]).toBe('[buildlite-timing]');
  expect(Object.keys(info.mock.calls[0][1]).sort()).toEqual(['durationMs', 'event']);
  expect(info.mock.calls[0][1].event).toBe('auth_me_request');
  expect(JSON.stringify(info.mock.calls)).not.toMatch(/token|email|tenant|database|authorization|cookie|secret/i);
});
