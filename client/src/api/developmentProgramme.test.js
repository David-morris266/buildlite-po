import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DevelopmentProgrammeApiError,
  getDevelopmentProgramme,
  putDevelopmentProgramme,
} from './developmentProgramme';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('development programme API', () => {
  it('loads the tenant-scoped programme route', async () => {
    const programme = { developmentId: 'dev-1', exists: false, version: 0 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(programme),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getDevelopmentProgramme('dev-1')).resolves.toEqual(programme);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/developments/dev-1/programme')
    );
  });

  it('sends the exact typed programme payload without client actor or tenant identity', async () => {
    const payload = {
      siteStart: '2027-03-01',
      firstCompletion: null,
      finalCompletion: '2030-08-31',
      totalPlots: 31,
      version: 0,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ...payload, exists: true, version: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await putDevelopmentProgramme('dev-1', payload);
    const options = fetchMock.mock.calls[0][1];
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual(payload);
    expect(JSON.parse(options.body)).not.toHaveProperty('actor');
    expect(JSON.parse(options.body)).not.toHaveProperty('clientId');
  });

  it('retains conflict status and server evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => JSON.stringify({ message: 'Programme version conflict.', programme: { version: 2 } }),
    }));

    await expect(putDevelopmentProgramme('dev-1', { version: 1 })).rejects.toMatchObject({
      name: 'DevelopmentProgrammeApiError',
      status: 409,
      body: { programme: { version: 2 } },
    });
    await expect(Promise.resolve(new DevelopmentProgrammeApiError('x'))).resolves.toBeInstanceOf(Error);
  });
});
