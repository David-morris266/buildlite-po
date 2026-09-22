/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PrelimsCostCodePicker from './PrelimsCostCodePicker';

const options = [{ code: '2100', description: 'Site Manager' }, { code: '2200', description: 'Site Engineer' }];

describe('Prelims Cost Code picker deliberate opening', () => {
  let root; let host;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); });

  it('is one closed combobox showing selection and opens only through deliberate interaction', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(<PrelimsCostCodePicker name="Prelims" options={options} value="2100" onChange={vi.fn()} />));
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(host.querySelector('input').value).toBe('2100 — Site Manager');
    await act(async () => host.querySelector('[aria-label="Open Prelims Cost Code"]').click());
    expect(document.activeElement).toBe(host.querySelector('input'));
    expect(document.body.querySelector('[role="listbox"]')).toBeTruthy();
  });

  it('filters, selects by keyboard, closes with Escape and closes on outside click', async () => {
    const onChange = vi.fn(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(<PrelimsCostCodePicker name="Prelims" options={options} onChange={onChange} />));
    const input = host.querySelector('input');
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Engineer');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.body.textContent).toContain('2200 — Site Engineer');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onChange).toHaveBeenCalledWith('2200');
    await act(async () => input.focus());
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => input.focus());
    await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it('portals, positions and repositions the menu without treating menu scrolling as outside interaction', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(<div style={{ overflow: 'hidden' }}><PrelimsCostCodePicker name="Prelims" options={options} onChange={vi.fn()} /></div>));
    const input = host.querySelector('input');
    let rect = { left: 100, right: 400, top: 100, bottom: 140, width: 300, height: 40 };
    input.getBoundingClientRect = () => rect;
    await act(async () => input.focus());
    const menu = document.body.querySelector('[role="listbox"]');
    expect(menu).toBeTruthy();
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('144px');
    expect(menu.style.width).toBe('300px');

    await act(async () => menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await act(async () => menu.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 })));
    expect(document.body.querySelector('[role="listbox"]')).toBe(menu);

    rect = { left: 120, right: 420, top: 700, bottom: 740, width: 300, height: 40 };
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(menu.style.left).toBe('120px');
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(700);
    expect(Number.parseFloat(menu.style.top) + Number.parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(700);

    await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  });
});
