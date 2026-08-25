/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import DevelopmentSellingCostsWorkspace from './DevelopmentSellingCostsWorkspace';

vi.mock('../api/sellingCosts', () => ({
  SellingCostsApiError: class SellingCostsApiError extends Error {
    constructor(message, { status = 0, body = null } = {}) {
      super(message);
      this.name = 'SellingCostsApiError';
      this.status = status;
      this.body = body;
    }
  },
  getSellingCostsProposal: vi.fn(),
  putSellingCostsAssumption: vi.fn(),
}));

import {
  getSellingCostsProposal,
  putSellingCostsAssumption,
  SellingCostsApiError,
} from '../api/sellingCosts';

const defaultProposal = {
  mode: 'simple',
  assumptionSource: 'default',
  assumptionPercent: 2,
  forecastRevenue: 10444608,
  forecastSellingCosts: 208892.16,
  revenue: { ready: true, complete: true, state: 'ready', forecastRevenue: 10444608, hint: null },
  destination: {
    status: 'missing',
    costCodeKey: '5400',
    recommendedCode: '5400',
    message: 'Recommended destination 5400 is not on Cost Code Master yet.',
  },
  settings: { exists: false, id: null, version: 0, destinationCostCodeKey: null },
};

function setInputValue(element, value) {
  const proto = window.HTMLInputElement.prototype;
  const native = Object.getOwnPropertyDescriptor(proto, 'value').set;
  native.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('DevelopmentSellingCostsWorkspace', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getSellingCostsProposal.mockResolvedValue(defaultProposal);
    putSellingCostsAssumption.mockResolvedValue({
      ...defaultProposal,
      assumptionSource: 'user',
      assumptionPercent: 1.75,
      forecastSellingCosts: 182780.64,
      settings: { exists: true, version: 1, destinationCostCodeKey: null },
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function renderWorkspace() {
    await act(async () => {
      root.render(<DevelopmentSellingCostsWorkspace developmentId="dev-1" />);
    });
    await flush();
  }

  it('shows default known-answer proposal and assumption wording', async () => {
    await renderWorkspace();

    expect(document.querySelector('[data-testid="selling-costs-assumption-source"]')?.textContent).toContain(
      'DEFAULT ASSUMPTION'
    );
    expect(document.querySelector('[data-testid="selling-costs-forecast-revenue"]')?.textContent).toContain(
      '10,444,608'
    );
    expect(document.querySelector('[data-testid="selling-costs-forecast-amount"]')?.textContent).toContain(
      '208,892.16'
    );
    expect(document.body.textContent).toMatch(/assumption, not an itemised build-up/i);
    expect(document.body.textContent).toMatch(/Selling Costs forecast/);
    expect(document.querySelector('[data-testid="selling-costs-save"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="selling-costs-adopt"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/BuildLite standard hint/i);
    expect(document.body.textContent).not.toMatch(/Detailed itemised Selling Costs are not available/i);
  });

  it('saves edited percentage and shows saved state', async () => {
    await renderWorkspace();

    const input = document.querySelector('[data-testid="selling-costs-percent-input"]');
    await act(async () => {
      setInputValue(input, '1.75');
    });

    await act(async () => {
      document.querySelector('[data-testid="selling-costs-save"]')?.click();
    });
    await flush();

    expect(putSellingCostsAssumption).toHaveBeenCalledWith(
      'dev-1',
      expect.objectContaining({ version: 0, assumptionPercent: '1.75' })
    );
    expect(document.querySelector('[data-testid="selling-costs-assumption-source"]')?.textContent).toContain(
      'SAVED ASSUMPTION'
    );
    expect(document.querySelector('[data-testid="selling-costs-forecast-amount"]')?.textContent).toContain(
      '182,780.64'
    );
  });

  it('shows revenue warning when Forecast Revenue is unavailable', async () => {
    getSellingCostsProposal.mockResolvedValue({
      ...defaultProposal,
      forecastRevenue: null,
      forecastSellingCosts: null,
      revenue: {
        ready: false,
        state: 'unavailable',
        hint: 'Selling Costs forecast cannot be finalised because Forecast Revenue is unavailable.',
      },
    });

    await renderWorkspace();

    expect(document.querySelector('[data-testid="selling-costs-revenue-warning"]')?.textContent).toMatch(
      /Forecast Revenue is unavailable/i
    );
  });

  it('surfaces stale version conflict from API', async () => {
    putSellingCostsAssumption.mockRejectedValue(
      new SellingCostsApiError('Selling Costs settings version conflict.', {
        status: 409,
        body: {
          proposal: {
            ...defaultProposal,
            assumptionSource: 'user',
            assumptionPercent: 2.25,
            forecastSellingCosts: 235003.68,
            settings: { exists: true, version: 2 },
          },
        },
      })
    );

    await renderWorkspace();

    await act(async () => {
      document.querySelector('[data-testid="selling-costs-save"]')?.click();
    });
    await flush();

    expect(document.body.textContent).toMatch(/updated elsewhere/i);
    expect(document.querySelector('[data-testid="selling-costs-assumption-source"]')?.textContent).toContain(
      'SAVED ASSUMPTION'
    );
  });
});
