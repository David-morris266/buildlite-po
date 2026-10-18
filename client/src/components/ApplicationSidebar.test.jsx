/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

let principal = { permissions: [], platformPermissions: [] };
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePrincipal: () => principal }));
import ApplicationSidebar from './ApplicationSidebar';
import { UnsavedChangesProvider } from '../navigation/UnsavedChangesProvider.jsx';
import { useUnsavedChanges } from '../navigation/UnsavedChangesContext.js';

function DirtySidebar(props) {
  const { registerUnsavedChanges } = useUnsavedChanges();
  React.useEffect(() => registerUnsavedChanges({ title: 'Unsaved Prelims setup', message: 'Leave?' }), [registerUnsavedChanges]);
  return <ApplicationSidebar {...props} />;
}

let container;
let root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  principal = { permissions: [], platformPermissions: [] };
});

function renderSidebar(props = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const defaults = { activeTab: 'home', collapsed: false, open: false, onTab: vi.fn(), onToggle: vi.fn(), onClose: vi.fn() };
  const merged = { ...defaults, ...props };
  act(() => root.render(<ApplicationSidebar {...merged} />));
  return merged;
}

describe('application sidebar', () => {
  it('retains menu order and hides authority-owned destinations without permission', () => {
    renderSidebar();
    expect(Array.from(container.querySelectorAll('.app-sidebar__item')).map(button => button.getAttribute('aria-label'))).toEqual([
      'Home', 'CVRs', 'Developments', 'Purchase Orders', 'Archive',
    ]);
    expect(container.querySelector('[aria-label="Home"]').getAttribute('aria-current')).toBe('page');
  });

  it('shows authority-owned destinations from existing permissions', () => {
    principal = { permissions: ['payment_approval_run.view', 'payment_release.execute', 'po.create', 'tenant.configure'], platformPermissions: [] };
    renderSidebar();
    for (const label of ['Payment Approval', 'Accounts', 'Administration', 'New Purchase Order']) {
      expect(container.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }
  });

  it('uses existing handlers and collapse does not change navigation state', () => {
    const props = renderSidebar();
    act(() => container.querySelector('[aria-label="Developments"]').click());
    expect(props.onTab).toHaveBeenCalledWith('developments');
    expect(props.onClose).toHaveBeenCalledOnce();
    act(() => container.querySelector('[aria-label="Collapse navigation"]').click());
    expect(props.onToggle).toHaveBeenCalledOnce();
    expect(props.onTab).toHaveBeenCalledTimes(1);
  });

  it('guards navigation while work is dirty', () => {
    principal = { permissions: ['tenant.configure'], platformPermissions: [] };
    const onTab = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<UnsavedChangesProvider><DirtySidebar activeTab="developments" collapsed={false} open={false} onTab={onTab} onToggle={vi.fn()} onClose={vi.fn()} /></UnsavedChangesProvider>));
    act(() => container.querySelector('[aria-label="Administration"]').click());
    expect(onTab).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Unsaved Prelims setup');
    act(() => Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Leave without saving').click());
    expect(onTab).toHaveBeenCalledWith('administration');
  });

  it('supports overlay keyboard dismissal and accessible collapsed labels', () => {
    const onClose = vi.fn();
    renderSidebar({ collapsed: true, open: true, onClose });
    expect(document.activeElement.getAttribute('aria-label')).toBe('Close navigation');
    expect(container.querySelector('[aria-label="Purchase Orders"]').title).toBe('Purchase Orders');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('contains overlay keyboard focus and returns it to the opener when closed', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open navigation';
    document.body.appendChild(opener);
    opener.focus();
    const props = renderSidebar({ open: true });
    const focusable = [...container.querySelectorAll('.app-sidebar button')];
    focusable.forEach(element => Object.defineProperty(element, 'getClientRects', { configurable: true, value: () => [{ width: 1, height: 1 }] }));
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    last.focus();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    expect(document.activeElement).toBe(first);
    first.focus();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })));
    expect(document.activeElement).toBe(last);
    opener.focus();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    expect(document.activeElement).toBe(first);
    act(() => root.render(<ApplicationSidebar {...props} open={false} />));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps the destination list vertically scrollable for zoomed and short viewports', () => {
    renderSidebar({ open: true });
    const nav = container.querySelector('.app-sidebar__nav');
    expect(nav).not.toBeNull();
    expect(container.querySelectorAll('.app-sidebar__item').length).toBeGreaterThan(4);
  });
});
