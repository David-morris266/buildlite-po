import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';
import {
  getCertificateById,
  listCertificatesForPackage,
  patchCertificateForPackage,
  PaymentCertificateApiError,
} from './paymentCertificates';

describe('paymentCertificates API wrapper (BL-030B)', () => {
  let networkGuard;

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
    vi.unstubAllGlobals();
  });

  it('maps list responses from { certificates } and arrays', async () => {
    networkGuard = installNetworkGuard();
    const fetchMock = vi.fn(async (url) => {
      expect(String(url)).toContain('/api/packages/pkg-1/certificates');
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            certificates: [{ id: 'c1', certificateNumber: 1, status: 'draft' }],
          }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const listed = await listCertificatesForPackage('pkg-1');
    expect(listed).toEqual([{ id: 'c1', certificateNumber: 1, status: 'draft' }]);
  });

  it('maps get certificate documents', async () => {
    networkGuard = installNetworkGuard();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ id: 'c1', packageId: 'pkg-1', status: 'locked' }),
      }))
    );

    const document = await getCertificateById('pkg-1', 'c1');
    expect(document.id).toBe('c1');
    expect(document.status).toBe('locked');
  });

  it('throws structured PaymentCertificateApiError on failure', async () => {
    networkGuard = installNetworkGuard();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () => JSON.stringify({ message: 'Certificates unavailable' }),
      }))
    );

    await expect(listCertificatesForPackage('pkg-1')).rejects.toMatchObject({
      name: 'PaymentCertificateApiError',
      status: 500,
      message: 'Certificates unavailable',
    });
    expect(PaymentCertificateApiError.name).toBe('PaymentCertificateApiError');
  });

  it('PATCH sends actor but never createdBy or updatedBy when a session user is present', async () => {
    networkGuard = installNetworkGuard();
    const session = new Map([['userName', 'UAT QS']]);
    vi.stubGlobal('localStorage', {
      getItem: (key) => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, value),
      removeItem: (key) => session.delete(key),
      clear: () => session.clear(),
    });
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.actor).toBe('UAT QS');
      expect(body).not.toHaveProperty('createdBy');
      expect(body).not.toHaveProperty('updatedBy');
      expect(body.version).toBe(1);
      expect(body.progress['plot-1-2::Joists'].thisCertificatePct).toBe(50);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'c1', version: 2, progress: body.progress }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await patchCertificateForPackage('pkg-1', 'c1', {
      version: 1,
      progress: {
        'plot-1-2::Joists': {
          plotId: 'plot-1-2',
          stageKey: 'Joists',
          thisCertificatePct: 50,
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('networkGuard blocks localhost:3001 in client tests', async () => {
    networkGuard = installNetworkGuard();
    await expect(listCertificatesForPackage('pkg-live')).rejects.toThrow(/NETWORK GUARD/);
    expect(() => networkGuard.assertNoLiveApiCalls()).toThrow(/Live API calls detected/);
    networkGuard.restore();
    networkGuard = null;
  });
});
