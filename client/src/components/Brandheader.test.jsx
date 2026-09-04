/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

let permissions = [];
vi.mock('../auth/BuildLiteAuthProvider', () => ({
  useBuildLitePrincipal: () => ({ permissions }),
  useBuildLitePermission: permission => permissions.includes(permission),
}));
vi.mock('../commercialAssistant/CommercialAssistantIndicator', () => ({ default: () => null }));
import BrandHeader from './Brandheader';

let container;
let root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  permissions = [];
});

describe('GP-1 top navigation', () => {
  it('keeps Home and removes the misleading Payment Certificates entry', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<BrandHeader activeTab="home" onTab={vi.fn()} />));
    expect(container.textContent).toContain('Home');
    expect(container.textContent).not.toContain('Payment Certificates');
  });

  it('shows authority-owned navigation by permission rather than role', () => {
    permissions = ['payment_approval_run.view', 'payment_release.execute', 'po.create', 'tenant.configure'];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<BrandHeader activeTab="home" onTab={vi.fn()} />));
    for (const label of ['Payment Approval', 'Payment Release', 'New Purchase Order', 'Administration']) {
      expect(container.textContent).toContain(label);
    }
  });
});
