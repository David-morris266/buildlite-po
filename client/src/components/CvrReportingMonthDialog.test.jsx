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
    const create = [...container.querySelectorAll('button')].find((item) =>
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
    const cancel = [...container.querySelectorAll('button')].find((item) =>
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
          nextPeriodKey="P02"
          suggestedMonth="2026-09"
          onCancel={() => {}}
          onConfirm={onConfirm}
        />
      );
    });
    const input = container.querySelector('input[type="month"]');
    expect(input?.value).toBe('2026-09');
    await act(async () => {
      setInputValue(input, '2026-10');
    });
    const create = [...container.querySelectorAll('button')].find((item) =>
      /Create P02/i.test(item.textContent || '')
    );
    expect(create?.disabled).toBe(false);
    await act(async () => {
      create.click();
    });
    expect(onConfirm).toHaveBeenCalledWith('2026-10');
  });
});
