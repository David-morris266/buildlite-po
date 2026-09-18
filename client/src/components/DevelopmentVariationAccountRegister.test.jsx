// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DevelopmentVariationAccountRegister from './DevelopmentVariationAccountRegister';
import { listVariationAccount } from '../api/variationAccounts';

vi.mock('../api/variationAccounts', () => ({ listVariationAccount: vi.fn() }));

const packages = [
  { id: 'pkg-1', packageUuid: 'pkg-1', orderKey: 'order-1', developmentId: 'dev-1', supplierId: 'supplier-1', supplierLabel: 'Peak Roofing', packageName: 'Roofing package', costCode: '4180' },
  { id: 'pkg-2', packageUuid: 'pkg-2', orderKey: 'dev-1::supplier-2::2220', developmentId: 'dev-1', supplierId: 'supplier-2', supplierLabel: 'Groundworks Ltd', costCode: '2220' },
];

async function render(onOpenPackage = vi.fn()) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<DevelopmentVariationAccountRegister packages={packages} onOpenPackage={onOpenPackage} />); await Promise.resolve(); await Promise.resolve(); });
  return { host, root, onOpenPackage };
}

function search(host, value) {
  const input = host.querySelector('input[type="search"]');
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('DevelopmentVariationAccountRegister', () => {
  beforeEach(() => {
    listVariationAccount.mockImplementation(async packageId => packageId === 'pkg-1' ? [{ id: 'va-1', reference: 'VA-0001', description: 'Revised valley detail', costCode: '4180', qsForecast: 8000, forecastStatus: 'assessed', status: 'active' }] : [{ id: 'va-2', reference: 'VA-0002', description: 'Compound change', costCode: '2220', qsForecast: 3500, forecastStatus: 'assessed', status: 'active' }]);
  });

  it('loads authoritative package items and searches reference, description, supplier, Cost Code and package', async () => {
    const { host } = await render();
    expect(host.textContent).toContain('VA-0001'); expect(host.textContent).toContain('VA-0002');
    expect(host.textContent).toContain('Variation Accounts track the forecast and recognised commercial position');
    expect(host.textContent).toContain('prevent double counting');
    expect(host.textContent).toContain('Variation Account item');
    expect(host.textContent).toContain('Roofing package');
    expect(host.textContent).not.toContain('dev-1::supplier-2::2220');
    for (const query of ['VA-0001', 'valley', 'Peak Roofing', '4180', 'Roofing package']) {
      search(host, query); expect(host.textContent).toContain('VA-0001'); expect(host.textContent).not.toContain('VA-0002');
    }
  });

  it('opens the owning package Variation Account with stable item identity', async () => {
    const { host, onOpenPackage } = await render();
    search(host, 'VA-0001');
    act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'Open item').click());
    expect(onOpenPackage).toHaveBeenCalledWith('order-1', expect.objectContaining({ initialTab: 'variation-account', variationAccountTarget: { itemId: 'va-1', reference: 'VA-0001' } }));
  });
});
