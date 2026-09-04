/* @vitest-environment jsdom */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let permissions = [];
vi.mock('../auth/BuildLiteAuthProvider', () => ({
  useBuildLitePrincipal: () => ({ user: { displayName: 'David Morris' }, activeTenant: { name: 'Hawthorn' }, permissions }),
  useBuildLitePermission: permission => permissions.includes(permission),
}));
import BuildLiteHome from './BuildLiteHome';

let container;
let root;
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); container = null; root = null; permissions = []; });
function renderHome(onNavigate = vi.fn()) {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); act(() => root.render(<BuildLiteHome onNavigate={onNavigate} />));
  return { onNavigate, text: () => container.textContent, buttons: () => [...container.querySelectorAll('button')] };
}

describe('GP-1 BuildLite Home', () => {
  it('shows core navigation but hides permission-owned workflows', () => {
    const view = renderHome();
    expect(view.text()).toContain('Developments & Packages');
    expect(view.text()).toContain('Applications & Certificates');
    expect(view.text()).not.toContain('Payment Approval');
    expect(view.text()).not.toContain('Payment Release');
    expect(view.text()).not.toContain('New Purchase Order');
  });

  it('uses permissions rather than role names for workflow links', () => {
    permissions = ['po.create', 'payment_approval_run.view', 'payment_release.execute', 'tenant.configure'];
    const view = renderHome();
    for (const label of ['New Purchase Order', 'Payment Approval', 'Payment Release', 'Administration']) expect(view.text()).toContain(label);
    const release = view.buttons().find(button => button.textContent.includes('Payment Release'));
    act(() => release.click());
    expect(view.onNavigate).toHaveBeenCalledWith({ view: 'payment-release' });
  });
});
