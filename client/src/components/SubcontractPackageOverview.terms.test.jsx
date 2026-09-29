/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listSubcontractTerms = vi.hoisted(() => vi.fn());
const confirmApprovedPoSubcontractTerms = vi.hoisted(() => vi.fn());
const useBuildLitePermission = vi.hoisted(() => vi.fn(() => true));

vi.mock('../api/subcontractTerms', () => ({ listSubcontractTerms, confirmApprovedPoSubcontractTerms }));
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission }));

import SubcontractPackageOverview from './SubcontractPackageOverview';

function packageFixture(governingTerms) {
  return {
    matrixReady: true,
    matrixExists: true,
    matrixStatusLabel: 'Ready',
    matrixPlotCount: 12,
    status: { modifier: 'approved', label: 'Approved' },
    recoverySummary: { hasRecoveries: false },
    supplierLabel: 'Groundworks Ltd',
    projectLabel: 'Willow Gardens',
    createdAt: '2026-09-29',
    updatedAt: '2026-09-29',
    poNumbers: ['S0001'],
    pos: [{ poNumber: 'S0001', title: 'Groundworks', subtotal: 100000, status: 'Approved' }],
    governingTerms,
    activity: [],
  };
}

async function render(pkg, onTermsConfigured = vi.fn()) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<SubcontractPackageOverview pkg={pkg} onTermsConfigured={onTermsConfigured} />));
  return { host, root, onTermsConfigured };
}

describe('Subcontract package contract terms setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBuildLitePermission.mockReturnValue(true);
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('gives an unconfigured clean-company package an explicit route to published company terms', async () => {
    listSubcontractTerms.mockResolvedValue({ families: [] });
    const { host, root } = await render(packageFixture({
      state: 'unconfigured',
      message: 'Contract terms: Not configured',
      orders: [{ poNumber: 'S0001', terms: { state: 'unconfigured' } }],
    }));

    const launch = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Configure contract terms');
    expect(launch).toBeTruthy();
    await act(async () => launch.click());
    expect(listSubcontractTerms).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('No published company subcontract terms are available');
    expect(host.textContent).toContain('Administration → Subcontract Terms');
    await act(async () => root.unmount());
  });

  it('prospectively confirms a published version and requests authoritative package/certificate refresh', async () => {
    listSubcontractTerms.mockResolvedValue({ families: [{
      id: 'family-1',
      name: 'Standard subcontract terms',
      versions: [{ id: 'terms-1', status: 'published', version_label: 'Standard 2026', revision_number: 1 }],
    }] });
    confirmApprovedPoSubcontractTerms.mockResolvedValue({ state: 'bound' });
    const { host, root, onTermsConfigured } = await render(packageFixture({
      state: 'unconfigured',
      message: 'Contract terms: Not configured',
      orders: [{ poNumber: 'S0001', terms: { state: 'unconfigured' } }],
    }));

    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Configure contract terms').click());
    const reason = host.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
        reason,
        'Confirmed prospectively before Certificate 1 submission'
      );
      reason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const confirm = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Confirm contract terms');
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());

    expect(confirmApprovedPoSubcontractTerms).toHaveBeenCalledWith(
      'S0001',
      'terms-1',
      'Confirmed prospectively before Certificate 1 submission'
    );
    expect(onTermsConfigured).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it('does not expose prospective confirmation without authority or for multiple linked orders', async () => {
    useBuildLitePermission.mockReturnValue(false);
    let rendered = await render(packageFixture({ state: 'unconfigured', orders: [{ poNumber: 'S0001' }] }));
    expect(rendered.host.textContent).not.toContain('Configure contract terms');
    await act(async () => rendered.root.unmount());

    useBuildLitePermission.mockReturnValue(true);
    rendered = await render(packageFixture({ state: 'unconfigured', orders: [{ poNumber: 'S0001' }, { poNumber: 'S0002' }] }));
    expect(rendered.host.textContent).not.toContain('Configure contract terms');
    expect(rendered.host.textContent).toContain('each linked Purchase Order');
    await act(async () => rendered.root.unmount());
  });
});
