/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./POPageHeader', () => ({ default: () => <div>Package header</div> }));
vi.mock('./OrderMatrixPlaceholderPreview', () => ({ default: () => <div>Matrix</div> }));
vi.mock('./SubcontractPackageOverview', () => ({
  default: () => <div>Overview</div>,
  SubcontractPackageDashboard: () => <div>Package dashboard</div>,
  SubcontractPackageSummary: () => <div>Package summary</div>,
}));
vi.mock('./PaymentCertificateWorkspace', () => ({
  default: ({ onDetailModeChange, certificateTarget }) => <div>
    <div>Certificate workspace</div>
    <div data-testid="certificate-target">{certificateTarget?.certificateId || ''}</div>
    <button type="button" onClick={() => onDetailModeChange(true)}>Open certificate</button>
    <button type="button" onClick={() => onDetailModeChange(false)}>Back to Certificates</button>
  </div>,
}));
vi.mock('./PackageCommercialEvents', () => ({ default: () => null }));
vi.mock('./PackageCommercialHistory', () => ({ default: () => null }));
vi.mock('./PackageVariationAccount', () => ({ default: () => null }));
vi.mock('../commercialAssistant/usePackageWorkspaceAssistantScope', () => ({ usePackageWorkspaceAssistantScope: () => {} }));
vi.mock('../payments/usePaymentCertificateServerHydration', () => ({
  usePaymentCertificateServerHydration: () => ({ certificatesReady: true, hydratedPackage: null }),
  mergeHydratedPackageIntoOrder: (order) => order,
}));
vi.mock('../payments/subcontractPackage', () => ({
  buildPackageViewModel: () => ({ id: 'pkg-1', packageUuid: 'pkg-1' }),
}));
vi.mock('../navigation/navigationBuilders', () => ({
  buildPackageWorkspaceNavigation: () => ({ breadcrumbs: [], title: 'Package', onBack: vi.fn() }),
}));

import SubcontractPackageWorkspace from './SubcontractPackageWorkspace';

describe('GP-2A focused certificate mode', () => {
  let container;
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
  });

  it('hides the package shell for certificate detail and restores it on Back', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<SubcontractPackageWorkspace order={{ orderKey: 'order-1', supplierLabel: 'Supplier', projectLabel: 'Package' }} initialTab="certificates" />));

    expect(container.textContent).toContain('Package dashboard');
    expect(container.querySelector('[aria-label="Package sections"]')).toBeTruthy();

    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Open certificate').click());
    expect(container.textContent).not.toContain('Package dashboard');
    expect(container.textContent).not.toContain('Package summary');
    expect(container.querySelector('[aria-label="Package sections"]')).toBeNull();

    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Back to Certificates').click());
    expect(container.textContent).toContain('Package dashboard');
    expect(container.querySelector('[aria-label="Package sections"]')).toBeTruthy();
  });

  it('targets the exact certificate and does not renotify when callback identity changes', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const first = vi.fn();
    const second = vi.fn();
    const props = {
      order: { orderKey: 'order-1', supplierLabel: 'Supplier', projectLabel: 'Package' },
      initialTab: 'certificates',
      certificateTarget: { certificateId: 'certificate-22', navigationKey: 'certificate-22' },
    };

    act(() => root.render(<SubcontractPackageWorkspace {...props} onTabChange={first} />));
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith('certificates');
    expect(container.querySelector('[data-testid="certificate-target"]').textContent).toBe('certificate-22');

    act(() => root.render(<SubcontractPackageWorkspace {...props} onTabChange={second} />));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Overview').click());
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith('overview');
  });
});
