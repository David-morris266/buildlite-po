/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PODrawerShell from './PODrawerShell';

describe('PODrawerShell focus stabilisation', () => {
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

  function renderDrawer({ open, onClose, secondLabel = 'Second' }) {
    act(() => {
      root.render(
        <PODrawerShell open={open} onClose={onClose} ariaLabel="Test drawer">
          <button type="button">First</button>
          <button type="button">{secondLabel}</button>
        </PODrawerShell>
      );
    });
  }

  it('autofocuses the first control when initially opened', () => {
    renderDrawer({ open: true, onClose: vi.fn() });

    const first = document.querySelector('button');
    expect(document.activeElement).toBe(first);
    expect(first?.textContent).toBe('First');
  });

  it('does not refocus when parent rerenders while drawer remains open', () => {
    const onClose = vi.fn();
    renderDrawer({ open: true, onClose });

    const second = document.querySelectorAll('button')[1];
    act(() => {
      second.focus();
    });
    expect(document.activeElement).toBe(second);

    renderDrawer({ open: true, onClose, secondLabel: 'Second updated' });
    expect(document.activeElement).toBe(second);
  });

  it('does not refocus when onClose reference changes while open', () => {
    renderDrawer({ open: true, onClose: vi.fn() });

    const second = document.querySelectorAll('button')[1];
    act(() => {
      second.focus();
    });

    renderDrawer({ open: true, onClose: vi.fn() });
    expect(document.activeElement).toBe(second);
  });

  it('autofocuses again after closing and reopening', () => {
    const onClose = vi.fn();
    renderDrawer({ open: true, onClose });

    const second = document.querySelectorAll('button')[1];
    act(() => {
      second.focus();
    });

    renderDrawer({ open: false, onClose });
    renderDrawer({ open: true, onClose });

    const first = document.querySelector('button');
    expect(document.activeElement).toBe(first);
  });

  it('calls the latest onClose when Escape is pressed', () => {
    const firstClose = vi.fn();
    renderDrawer({ open: true, onClose: firstClose });

    const latestClose = vi.fn();
    renderDrawer({ open: true, onClose: latestClose });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(firstClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledTimes(1);
  });

  it('keeps focus trap behaviour when tabbing between controls', () => {
    renderDrawer({ open: true, onClose: vi.fn() });

    const [first, second] = document.querySelectorAll('button');
    act(() => {
      first.focus();
    });

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      );
    });
    expect(document.activeElement).toBe(second);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(first);
  });
});
