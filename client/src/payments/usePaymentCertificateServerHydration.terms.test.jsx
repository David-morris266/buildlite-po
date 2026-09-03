/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchPackageByOrderKey = vi.hoisted(() => vi.fn());
const ensureCertificatesReadyForPackage = vi.hoisted(() => vi.fn());

vi.mock('./packageStore', () => ({
  fetchPackageByOrderKey,
  getCachedPackageByOrderKey: () => null,
}));
vi.mock('./paymentCertificateAuthority', () => ({
  isPaymentCertificateServerAuthorityEnabled: () => true,
}));
vi.mock('./paymentCertificateServerCache', () => ({
  ensureCertificatesReadyForPackage,
  getCertificateLoadError: () => null,
  getCertificateLoadState: () => 'loaded',
  rememberPackageUuidForOrderKey: vi.fn(),
}));

import { mergeHydratedPackageIntoOrder, usePaymentCertificateServerHydration } from './usePaymentCertificateServerHydration';

function Probe({ order }) {
  const state = usePaymentCertificateServerHydration(order);
  return <pre>{JSON.stringify(state)}</pre>;
}

describe('Payment Certificate package terms hydration', () => {
  let host;
  let root;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    vi.clearAllMocks();
  });

  it('merges the real server package UUID and contractual provenance over a PO-only workspace order', () => {
    const merged = mergeHydratedPackageIntoOrder(
      {
        id: 'dev::supplier::4330',
        orderKey: 'dev::supplier::4330',
        committedValue: 1000,
        pos: [{ poNumber: 'S0028' }],
      },
      {
        id: '410ad8ad-2a2f-4f58-8d6a-e16c9d98f6e4',
        orderKey: 'dev::supplier::4330',
        currentContractProvenance: {
          originalOrder: 1000,
          approvedUninstructedValue: 0,
          issuedVariationOrderValue: 12000,
          currentContract: 13000,
        },
      }
    );
    expect(merged.packageId).toBe('410ad8ad-2a2f-4f58-8d6a-e16c9d98f6e4');
    expect(merged.packageUuid).toBe('410ad8ad-2a2f-4f58-8d6a-e16c9d98f6e4');
    expect(merged.pos).toEqual([{ poNumber: 'S0028' }]);
    expect(merged.currentContractProvenance).toEqual({
      originalOrder: 1000,
      approvedUninstructedValue: 0,
      issuedVariationOrderValue: 12000,
      currentContract: 13000,
    });
  });

  it('keeps the PO-bound Revision 1 as Draft authority after the tenant default changes to Revision 2', async () => {
    fetchPackageByOrderKey.mockResolvedValue({
      id: 'e6167be3-ebde-4e6a-8452-ed7dda065e72',
      orderKey: 'hawthorn::cleanearth::3510',
      governingTerms: {
        state: 'common',
        source: 'tenant_default',
        version: {
          id: 'terms-revision-1',
          familyName: 'Standard Subcontract Terms',
          versionLabel: 'Standard 2026',
          revisionNumber: 1,
        },
      },
    });
    ensureCertificatesReadyForPackage.mockResolvedValue([]);

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<Probe order={{ orderKey: 'hawthorn::cleanearth::3510' }} />);
    });

    expect(fetchPackageByOrderKey).toHaveBeenCalledWith('hawthorn::cleanearth::3510');
    expect(host.textContent).toContain('terms-revision-1');
    expect(host.textContent).toContain('Standard 2026');
    expect(host.textContent).not.toContain('Revision 2');
  });
});
