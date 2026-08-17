import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';
import {
  getCertificateById,
  listCertificatesForPackage,
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

  it('networkGuard blocks localhost:3001 in client tests', async () => {
    networkGuard = installNetworkGuard();
    await expect(listCertificatesForPackage('pkg-live')).rejects.toThrow(/NETWORK GUARD/);
    expect(() => networkGuard.assertNoLiveApiCalls()).toThrow(/Live API calls detected/);
    networkGuard.restore();
    networkGuard = null;
  });
});
