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
import { UnsavedChangesProvider } from '../navigation/UnsavedChangesProvider.jsx';
import { useUnsavedChanges } from '../navigation/UnsavedChangesContext.js';

function DirtyHeader({ onTab }) {
  const { registerUnsavedChanges } = useUnsavedChanges();
  React.useEffect(
    () => registerUnsavedChanges({ title: 'Unsaved Prelims setup', message: 'Leave?' }),
    [registerUnsavedChanges]
  );
  return <BrandHeader activeTab="developments" onTab={onTab} />;
}

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
    for (const label of ['Payment Approval', 'Accounts', 'New Purchase Order', 'Administration']) {
      expect(container.textContent).toContain(label);
    }
    expect(container.textContent).not.toContain('Payment Release');
  });

  it('guards global module navigation while Prelims setup is dirty', () => {
    permissions = ['tenant.configure'];
    const onTab = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<UnsavedChangesProvider><DirtyHeader onTab={onTab} /></UnsavedChangesProvider>));
    act(() => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Administration').click());
    expect(onTab).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Unsaved Prelims setup');
    act(() => Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Leave without saving').click());
    expect(onTab).toHaveBeenCalledWith('administration');
  });
});
