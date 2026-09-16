/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CvrReportingMonthDialog from './CvrReportingMonthDialog';

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('CvrReportingMonthDialog (BL-033C.1)', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('blocks create while the month is blank', async () => {
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(
        <CvrReportingMonthDialog
          open
          nextPeriodKey="P04"
          suggestedMonth=""
          onCancel={() => {}}
          onConfirm={onConfirm}
        />
      );
    });
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement?.classList.contains('dev-cvr-add-backdrop')).toBe(true);
    const create = [...dialog.querySelectorAll('button')].find((item) =>
      /Create P04/i.test(item.textContent || '')
    );
    expect(create?.disabled).toBe(true);
    await act(async () => {
      create.click();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels without creating a period', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    await act(async () => {
      root.render(
        <CvrReportingMonthDialog
          open
          nextPeriodKey="P04"
          suggestedMonth="2026-09"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      );
    });
    const dialog = document.body.querySelector('[role="dialog"]');
    const cancel = [...dialog.querySelectorAll('button')].find((item) =>
      /^Cancel$/i.test(item.textContent || '')
    );
    await act(async () => {
      cancel.click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('prefills a safe suggestion and submits the selected YYYY-MM', async () => {
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(
        <CvrReportingMonthDialog
          open
          nextPeriodKey="P03"
          suggestedMonth="2027-01"
          onCancel={() => {}}
          onConfirm={onConfirm}
        />
      );
    });
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.textContent).toContain('Create P03');
    const input = dialog.querySelector('input[type="month"]');
    expect(input?.value).toBe('2027-01');
    await act(async () => {
      setInputValue(input, '2027-02');
    });
    const create = [...dialog.querySelectorAll('button')].find((item) =>
      /Create P03/i.test(item.textContent || '')
    );
    expect(create?.disabled).toBe(false);
    await act(async () => {
      create.click();
    });
    expect(onConfirm).toHaveBeenCalledWith('2027-02');
  });
});
