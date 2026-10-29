/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import PlotDrawer from './PlotDrawer';

describe('PlotDrawer selling price input', () => {
  it('does not constrain contractual sellingPrice to £1,000 steps', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'PlotDrawer.jsx'), 'utf8');
    const match = source.match(
      /<span className="dev-form__label">Selling Price<\/span>\s*<input[\s\S]*?\/>/
    );
    expect(match).toBeTruthy();
    expect(match[0]).toContain('type="number"');
    expect(match[0]).toContain('step="0.01"');
    expect(match[0]).not.toContain('step="1000"');
  });

  it('explains Reserved Selling Price authority without replacing the fallback source', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'PlotDrawer.jsx'), 'utf8');
    expect(source).toContain('Reserved Selling Price currently drives Forecast Revenue.');
    expect(source).toContain('remains stored and resumes if the plot returns to Available');
  });

  it('requires visible confirmation before a stale imported allocation can become Reserved', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSave = vi.fn();
    const plot = {
      id: 'p1', plotNumber: '1', houseType: 'A', tenureCode: 'OPEN_MARKET',
      revenueStatus: 'Available', revenueSource: 'Manual Value', manualForecastValue: 280000,
      sellingPrice: 275000, sellingPriceRequiresConfirmation: true,
    };
    act(() => root.render(createElement(PlotDrawer, {
      open: true,
      plot,
      developmentId: 'dev-1',
      onSave,
      onClose: vi.fn(),
    })));
    const status = [...container.querySelectorAll('label')].find((label) => label.textContent.includes('Revenue Status')).querySelector('select');
    act(() => { status.value = 'Reserved'; status.dispatchEvent(new Event('change', { bubbles: true })); });
    const confirmation = container.querySelector('input[type="checkbox"]');
    const save = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save Plot');
    expect(confirmation).toBeTruthy();
    expect(save.disabled).toBe(true);
    act(() => confirmation.click());
    expect(save.disabled).toBe(false);
    act(() => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      revenueStatus: 'Reserved',
      sellingPriceConfirmation: { requested: true },
    }));
    act(() => root.unmount());
    container.remove();
  });
});
