/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hydration = vi.hoisted(() => vi.fn((order, refreshToken) => ({
  certificatesLoading: false, certificatesReady: true, certificatesError: '',
  governingTerms: null,
  hydratedPackage: refreshToken > 0 ? { ...order, currentContract: 1100 } : { ...order, currentContract: 1000 },
})));

vi.mock('../payments/usePaymentCertificateServerHydration', () => ({
  mergeHydratedPackageIntoOrder: (order, hydratedPackage) => ({ ...order, ...hydratedPackage }),
  usePaymentCertificateServerHydration: hydration,
}));
vi.mock('./POPageHeader', () => ({ default: () => null }));
vi.mock('./SubcontractPackageOverview', () => ({ default: () => null, SubcontractPackageDashboard: ({ pkg }) => <output data-testid="current-contract">{pkg.currentContract}</output>, SubcontractPackageSummary: () => null }));
vi.mock('./OrderMatrixPlaceholderPreview', () => ({ default: () => null }));
vi.mock('./PaymentCertificateWorkspace', () => ({ default: () => null }));
vi.mock('./PackageCommercialEvents', () => ({ default: () => null }));
vi.mock('./PackageCommercialHistory', () => ({ default: () => null }));
vi.mock('./PackageVariationAccount', () => ({ default: () => null }));
vi.mock('../commercialAssistant/usePackageWorkspaceAssistantScope', () => ({ usePackageWorkspaceAssistantScope: () => {} }));
vi.mock('../payments/subcontractPackage', () => ({ buildPackageViewModel: order => ({ ...order, matrixExists: false }) }));

import { notifyCommercialChanged } from '../commercial/commercialEvents';
import SubcontractPackageWorkspace from './SubcontractPackageWorkspace';

describe('SubcontractPackageWorkspace authoritative commercial refresh', () => {
  let host; let root;
  const order = { id: 'package-1', packageUuid: 'package-1', orderKey: 'PO-1', developmentId: 'dev-1', supplierLabel: 'Supplier', projectLabel: 'Development' };
  beforeEach(() => { hydration.mockClear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('advances canonical package hydration after a scoped CE/VO success signal', async () => {
    await act(async () => { root.render(<SubcontractPackageWorkspace order={order} />); await Promise.resolve(); });
    expect(hydration).toHaveBeenLastCalledWith(order, 0);
    expect(host.querySelector('[data-testid="current-contract"]').textContent).toBe('1000');
    act(() => notifyCommercialChanged({ developmentId: 'dev-1', packageId: 'package-1', source: 'variation-order', status: 'issued' }));
    expect(hydration).toHaveBeenLastCalledWith(order, 1);
    expect(host.querySelector('[data-testid="current-contract"]').textContent).toBe('1100');
  });

  it('ignores explicitly scoped changes for another package', async () => {
    await act(async () => { root.render(<SubcontractPackageWorkspace order={order} />); await Promise.resolve(); });
    const calls = hydration.mock.calls.length;
    act(() => notifyCommercialChanged({ developmentId: 'dev-1', packageId: 'package-2', action: 'approved' }));
    expect(hydration).toHaveBeenCalledTimes(calls);
  });
});
