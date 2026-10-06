/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const revenue = vi.hoisted(() => ({
  getPricing: vi.fn(),
  savePricing: vi.fn(),
  syncPlots: vi.fn(),
}));

vi.mock('../revenue/revenueStrategy', () => ({
  getHouseTypePricing: (...args) => revenue.getPricing(...args),
  saveHouseTypePricing: (...args) => revenue.savePricing(...args),
  syncPlotForecastPrices: (...args) => revenue.syncPlots(...args),
}));

import HouseTypeRevenueTable from './HouseTypeRevenueTable';

const rows = [
  {
    houseType: 'Ashford', niaFt2: 0, niaSource: 'unresolved', derivedNiaFt2: 0,
    garage: 'None', sellingBasis: 'Auto', manualForecastValue: 0, forecastValue: 0,
    hasPlotAreaConflict: false, distinctPlotNiaValues: [],
  },
  {
    houseType: 'Bramley', niaFt2: 950, niaSource: 'plot_master', derivedNiaFt2: 950,
    garage: 'None', sellingBasis: 'Auto', manualForecastValue: 0, forecastValue: 332500,
    hasPlotAreaConflict: true, distinctPlotNiaValues: [900, 1000],
  },
];

const settle = async () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
});

describe('HouseTypeRevenueTable representative NIA authority', () => {
  let container;
  let root;

  beforeEach(() => {
    revenue.getPricing.mockReturnValue({
      Bramley: { garage: 'None', sellingBasis: 'Auto', manualForecastValue: 0, representativeNiaFt2: null },
    });
    revenue.savePricing.mockResolvedValue({ ok: true });
    revenue.syncPlots.mockResolvedValue({ ok: true, updatedCount: 4 });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows editable explicit authority, derived provenance, unresolved state and conflict warning', async () => {
    await act(async () => root.render(<HouseTypeRevenueTable developmentId="dev-1" houseTypeRows={rows} />));
    expect(container.textContent).toContain('not copied into Plot Master');
    expect(container.textContent).toContain('Unresolved');
    expect(container.textContent).toContain('Derived from Plot Master: 950 ft²');
    expect(container.textContent).toContain('matching plots contain 900, 1,000 ft²');
    expect(container.querySelector('[aria-label="Ashford NIA (ft²)"]')).toBeTruthy();
  });

  it('persists one positive NIA through existing settings and then synchronizes eligible forecasts', async () => {
    await act(async () => root.render(<HouseTypeRevenueTable developmentId="dev-1" houseTypeRows={rows} />));
    const input = container.querySelector('[aria-label="Ashford NIA (ft²)"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '750');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save House Type Pricing').click());
    await settle();
    expect(revenue.savePricing).toHaveBeenCalledWith('dev-1', expect.objectContaining({
      Ashford: expect.objectContaining({ representativeNiaFt2: 750 }),
    }));
    expect(revenue.syncPlots).toHaveBeenCalledWith('dev-1');
  });

  it('allows blank unresolved NIA but rejects zero and invalid values without saving', async () => {
    await act(async () => root.render(<HouseTypeRevenueTable developmentId="dev-1" houseTypeRows={rows} />));
    const input = container.querySelector('[aria-label="Ashford NIA (ft²)"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '0');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('Enter a positive NIA');
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save House Type Pricing').click());
    await settle();
    expect(revenue.savePricing).not.toHaveBeenCalled();
    expect(revenue.syncPlots).not.toHaveBeenCalled();
  });
});
