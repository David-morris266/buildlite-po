/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

let principal;
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePrincipal: () => principal }));
vi.mock('../commercialAssistant/CommercialAssistantIndicator', () => ({ default: () => <button type="button">Commercial Assistant</button> }));
import BrandHeader from './Brandheader';
import { UnsavedChangesProvider } from '../navigation/UnsavedChangesProvider.jsx';
import { useUnsavedChanges } from '../navigation/UnsavedChangesContext.js';

function DirtyHeader() {
  const { registerUnsavedChanges } = useUnsavedChanges();
  React.useEffect(() => registerUnsavedChanges({ title: 'Unsaved setup', message: 'Leave?' }), [registerUnsavedChanges]);
  return <BrandHeader onOpenNavigation={vi.fn()} />;
}

let container;
let root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  principal = undefined;
});

function renderHeader(props = {}) {
  principal = principal || { user: { displayName: 'Alex Morgan' }, activeTenant: { clientId: 'hawthorn', name: 'Hawthorn Gardens', roleName: 'Commercial Director' }, memberships: [], switchTenant: vi.fn() };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<BrandHeader {...props} />));
}

describe('compact application top bar', () => {
  it('retains company, authenticated user and assistant controls without duplicating global navigation', () => {
    const onOpenNavigation = vi.fn();
    renderHeader({ onOpenNavigation });
    expect(container.textContent).toContain('Hawthorn Gardens');
    expect(container.textContent).toContain('Alex Morgan');
    expect(container.textContent).toContain('Commercial Director');
    expect(container.textContent).toContain('Commercial Assistant');
    expect(container.textContent).not.toContain('Purchase Orders');
    act(() => container.querySelector('[aria-label="Open navigation"]').click());
    expect(onOpenNavigation).toHaveBeenCalledOnce();
  });

  it('switches only to an authorised company membership', () => {
    principal = {
      user: { displayName: 'Alex Morgan' }, activeTenant: { clientId: 'hawthorn', name: 'Hawthorn Gardens', roleName: 'Commercial Director' },
      memberships: [
        { clientId: 'hawthorn', clientName: 'Hawthorn Gardens', roleName: 'Commercial Director' },
        { clientId: 'willow', clientName: 'Willow Homes', roleName: 'QS' },
      ],
      switchTenant: vi.fn(),
    };
    renderHeader();
    const selector = container.querySelector('[aria-label="Switch active company"]');
    expect(Array.from(selector.options).map(option => option.value)).toEqual(['hawthorn', 'willow']);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(selector, 'willow');
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(principal.switchTenant).toHaveBeenCalledWith('willow');
  });

  it('preserves the unsaved-change guard when switching company', () => {
    principal = {
      user: { displayName: 'Alex Morgan' }, activeTenant: { clientId: 'hawthorn', name: 'Hawthorn Gardens', roleName: 'Commercial Director' },
      memberships: [
        { clientId: 'hawthorn', clientName: 'Hawthorn Gardens', roleName: 'Commercial Director' },
        { clientId: 'willow', clientName: 'Willow Homes', roleName: 'QS' },
      ],
      switchTenant: vi.fn(),
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<UnsavedChangesProvider><DirtyHeader /></UnsavedChangesProvider>));
    const selector = container.querySelector('[aria-label="Switch active company"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(selector, 'willow');
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(principal.switchTenant).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Unsaved setup');
    act(() => Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Leave without saving').click());
    expect(principal.switchTenant).toHaveBeenCalledWith('willow');
  });
});
