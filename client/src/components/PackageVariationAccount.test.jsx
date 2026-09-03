/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), eligible: vi.fn(), allocate: vi.fn(), reverse: vi.fn() }));
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: () => true }));
vi.mock('../api/variationAccounts', () => ({ listVariationAccount: mocks.list, listEligibleVariationAuthority: mocks.eligible, allocateVariationAuthority: mocks.allocate, reverseVariationAuthority: mocks.reverse }));
import PackageVariationAccount from './PackageVariationAccount';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function render(items, sources = []) {
  mocks.list.mockResolvedValue(items); mocks.eligible.mockResolvedValue(sources);
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(<PackageVariationAccount packageId="pkg" />));
  await act(async () => Promise.resolve());
  return { host, root };
}

describe('PackageVariationAccount', () => {
  afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = ''; });
  it('shows forecast, CE/VO authority, remaining exposure and explicit overlap choice', async () => {
    const { host, root } = await render([{ id: 'va1', reference: 'VA-0001', description: 'Drainage changes', qsForecast: 17000, authority: { allocatedCeAuthority: 8000, allocatedVoAuthority: 12000, effectiveRecognisedAuthority: 12000, remainingForecastExposure: 5000, allocations: [{ id: 'a1', sourceType: 'commercial_event', sourceReference: 'CE-1', allocatedAmount: 8000, effectiveAmount: 0, allocationKind: 'authority' }] } }], [{ sourceType: 'variation_order_line', sourceId: 'line1', reference: 'PO/VO-1', availableAmount: 12000 }]);
    expect(host.textContent).toContain('VA-0001'); expect(host.textContent).toContain('£17,000.00'); expect(host.textContent).toContain('£12,000.00'); expect(host.textContent).toContain('£5,000.00'); expect(host.textContent).toContain('Additional authority'); expect(host.textContent).toContain('Replaces existing authority');
    await act(async () => root.unmount());
  });
  it('seeds an exact predecessor amount and prevents wheel increments on money inputs', async () => {
    const { host, root } = await render([{ id: 'va1', reference: 'VA-0001', description: 'Drainage', qsForecast: 17000, authority: { allocations: [{ id: 'ce-allocation', sourceType: 'commercial_event', sourceReference: 'CE-0010', allocatedAmount: 8000, effectiveAmount: 8000, allocationKind: 'authority' }] } }], [{ sourceType: 'variation_order_line', sourceId: 'vo-line', reference: 'S0028/VO-0001', availableAmount: 12000 }]);
    const selects = host.querySelectorAll('select');
    await act(async () => { selects[1].value = 'replaces'; selects[1].dispatchEvent(new Event('change', { bubbles: true })); });
    const predecessor = host.querySelectorAll('select')[2];
    await act(async () => { predecessor.value = 'ce-allocation'; predecessor.dispatchEvent(new Event('change', { bubbles: true })); });
    const amount = Array.from(host.querySelectorAll('input[type="number"]')).at(-1);
    expect(amount.value).toBe('8000.00');
    amount.focus();
    await act(async () => amount.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 })));
    expect(document.activeElement).not.toBe(amount); expect(amount.value).toBe('8000.00');
    await act(async () => root.unmount());
  });
  it('surfaces a forecast-below-authority exception', async () => {
    const { host, root } = await render([{ id: 'va2', reference: 'VA-0002', description: 'Exposure', qsForecast: 7000, authority: { effectiveRecognisedAuthority: 8000, remainingForecastExposure: 0, forecastBelowAuthority: true, exception: 'QS Forecast is below effective recognised authority by £1000.00.', allocations: [] } }]);
    expect(host.querySelector('[role="alert"]').textContent).toContain('below effective recognised authority');
    await act(async () => root.unmount());
  });
});
