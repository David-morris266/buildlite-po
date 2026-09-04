/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), eligible: vi.fn(), allocate: vi.fn(), reverse: vi.fn(), revise: vi.fn(), permissions: new Set() }));
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: permission => mocks.permissions.has(permission) }));
vi.mock('../api/variationAccounts', () => ({ listVariationAccount: mocks.list, listEligibleVariationAuthority: mocks.eligible, allocateVariationAuthority: mocks.allocate, reverseVariationAuthority: mocks.reverse, reviseVariationForecast: mocks.revise }));
import PackageVariationAccount from './PackageVariationAccount';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function inputValue(element, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

async function render(items, sources = []) {
  mocks.list.mockResolvedValue(items); mocks.eligible.mockResolvedValue(sources);
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(<PackageVariationAccount packageId="pkg" />));
  await act(async () => Promise.resolve());
  return { host, root };
}

describe('PackageVariationAccount', () => {
  afterEach(() => { vi.clearAllMocks(); mocks.permissions.clear(); document.body.innerHTML = ''; });
  it('shows forecast, CE/VO authority, remaining exposure and explicit overlap choice', async () => {
    mocks.permissions.add('variation_account.authority_allocate');
    const { host, root } = await render([{ id: 'va1', reference: 'VA-0001', description: 'Drainage changes', qsForecast: 17000, authority: { allocatedCeAuthority: 8000, allocatedVoAuthority: 12000, effectiveRecognisedAuthority: 12000, remainingForecastExposure: 5000, allocations: [{ id: 'a1', sourceType: 'commercial_event', sourceReference: 'CE-1', allocatedAmount: 8000, effectiveAmount: 0, allocationKind: 'authority' }] } }], [{ sourceType: 'variation_order_line', sourceId: 'line1', reference: 'PO/VO-1', availableAmount: 12000 }]);
    expect(host.textContent).toContain('VA-0001'); expect(host.textContent).toContain('£17,000.00'); expect(host.textContent).toContain('£12,000.00'); expect(host.textContent).toContain('£5,000.00'); expect(host.textContent).toContain('Additional authority'); expect(host.textContent).toContain('Replaces existing authority');
    await act(async () => root.unmount());
  });
  it('seeds an exact predecessor amount and prevents wheel increments on money inputs', async () => {
    mocks.permissions.add('variation_account.authority_allocate');
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

  it('shows forecast revision only for authorised active items', async () => {
    mocks.permissions.add('variation_account.forecast_edit');
    const active = { id: 'va-active', reference: 'VA-0001', description: 'Active', qsForecast: 17000, status: 'active', version: 4, authority: {} };
    const resolved = { ...active, id: 'va-resolved', reference: 'VA-0002', status: 'resolved' };
    const withdrawn = { ...active, id: 'va-withdrawn', reference: 'VA-0003', status: 'withdrawn' };
    const { host, root } = await render([active, resolved, withdrawn]);
    expect(Array.from(host.querySelectorAll('button')).filter(button => button.textContent === 'Revise Forecast')).toHaveLength(1);
    await act(async () => root.unmount());

    mocks.permissions.clear();
    const denied = await render([active]);
    expect(denied.host.textContent).not.toContain('Revise Forecast');
    await act(async () => denied.root.unmount());
  });

  it('submits the revised forecast, version and mandatory reason, then reloads authoritative state', async () => {
    const commercialChanged = vi.fn();
    window.addEventListener('buildlite:commercial-changed', commercialChanged);
    mocks.permissions.add('variation_account.forecast_edit');
    const item = { id: 'va1', reference: 'VA-0001', description: 'Drainage', qsForecast: 17000, status: 'active', version: 4, authority: {} };
    const { host, root } = await render([item]);
    await act(async () => host.querySelector('button').click());
    const amount = host.querySelector('input[type="number"]');
    const reason = host.querySelector('input[aria-label$="forecast revision reason"]');
    expect(amount.value).toBe('17000');
    expect(Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Save revised forecast').disabled).toBe(true);
    await act(async () => {
      inputValue(amount, '18000');
      inputValue(reason, 'Updated risk assessment');
    });
    mocks.revise.mockResolvedValue({ ...item, qsForecast: 18000, version: 5 });
    mocks.list.mockResolvedValue([{ ...item, qsForecast: 18000, version: 5 }]);
    const save = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Save revised forecast');
    await act(async () => save.click());
    expect(mocks.revise).toHaveBeenCalledWith('va1', { version: 4, qsForecast: 18000, reason: 'Updated risk assessment' });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(commercialChanged).toHaveBeenCalledTimes(1);
    expect(commercialChanged.mock.calls[0][0].detail).toMatchObject({ source: 'variation_account_forecast', variationAccountItemId: 'va1' });
    expect(host.textContent).toContain('£18,000.00');
    expect(host.querySelector('input[aria-label$="forecast revision reason"]')).toBeNull();
    window.removeEventListener('buildlite:commercial-changed', commercialChanged);
    await act(async () => root.unmount());
  });

  it('accepts a signed forecast value', async () => {
    mocks.permissions.add('variation_account.forecast_edit');
    const item = { id: 'va1', reference: 'VA-0001', description: 'Credit', qsForecast: 100, status: 'active', version: 2, authority: {} };
    const { host, root } = await render([item]);
    await act(async () => host.querySelector('button').click());
    await act(async () => {
      inputValue(host.querySelector('input[type="number"]'), '-125.25');
      inputValue(host.querySelector('input[aria-label$="forecast revision reason"]'), 'Credit reassessment');
    });
    mocks.revise.mockResolvedValue({ ...item, qsForecast: -125.25, version: 3 });
    mocks.list.mockResolvedValue([{ ...item, qsForecast: -125.25, version: 3 }]);
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Save revised forecast').click());
    expect(mocks.revise).toHaveBeenCalledWith('va1', { version: 2, qsForecast: -125.25, reason: 'Credit reassessment' });
    await act(async () => root.unmount());
  });

  it('keeps the editor open and shows an optimistic-version conflict', async () => {
    mocks.permissions.add('variation_account.forecast_edit');
    const item = { id: 'va1', reference: 'VA-0001', description: 'Drainage', qsForecast: 17000, status: 'active', version: 4, authority: {} };
    const { host, root } = await render([item]);
    await act(async () => host.querySelector('button').click());
    const amount = host.querySelector('input[type="number"]');
    const reason = host.querySelector('input[aria-label$="forecast revision reason"]');
    await act(async () => {
      inputValue(amount, '18000');
      inputValue(reason, 'Reassessed');
    });
    mocks.revise.mockRejectedValue(new Error('Variation Account item changed elsewhere. Refresh and retry.'));
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Save revised forecast').click());
    expect(host.querySelector('[role="alert"]').textContent).toContain('changed elsewhere');
    expect(host.querySelector('input[aria-label$="forecast revision reason"]')).not.toBeNull();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});
