import { afterEach, describe, expect, it, vi } from 'vitest';
import { savePO } from './api';

describe('Purchase Order API errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows a JSON API message without rendering raw JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Purchase Order number could not be allocated safely. Please retry.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    )));
    await expect(savePO({ type: 'M' })).rejects.toThrow(
      'Purchase Order number could not be allocated safely. Please retry.'
    );
  });

  it('preserves readable non-JSON errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      'Gateway unavailable',
      { status: 503, headers: { 'Content-Type': 'text/plain' } }
    )));
    await expect(savePO({ type: 'M' })).rejects.toThrow('Gateway unavailable');
  });
});
