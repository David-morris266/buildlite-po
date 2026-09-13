/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let principal = { tenantReadiness: { configured: true } };
vi.mock('./auth/BuildLiteAuthProvider', () => ({
  useBuildLitePrincipal: () => principal,
}));
vi.mock('./components/Brandheader', () => ({
  default: ({ activeTab, onTab }) => <div data-testid="header">{activeTab}<button onClick={() => onTab('home')}>Home nav</button></div>,
}));
vi.mock('./components/BuildLiteHome', () => ({
  default: ({ onNavigate }) => <button onClick={() => onNavigate({ view: 'developments' })}>Developments & Packages</button>,
}));
vi.mock('./components/Developments', () => ({
  default: (props) => <div data-testid="developments" data-has-package-target={String('initialPackageTarget' in props)} data-development-id={props.initialDevelopmentId || ''} data-workspace-tab={props.initialWorkspaceTab || ''}>
    Developments list
    <button onClick={() => props.onNavigate?.({ view: 'administration', section: 'cost-codes', returnDevelopment: { id: 'dev-1', name: 'Pilot Site' } })}>Resolve Cost Codes</button>
    {props.initialDevelopmentId ? <button onClick={props.onInitialDevelopmentHandled}>Development handled</button> : null}
  </div>,
}));
vi.mock('./setup/SetupAssistant', () => ({
  default: () => <div>Setup Assistant</div>,
  dismissSetupAssistant: vi.fn(),
}));
vi.mock('./admin/commercialStructureStore', () => ({ getCommercialStructure: vi.fn() }));
vi.mock('./commercialAssistant/CommercialAssistantContext', () => ({ CommercialAssistantProvider: ({ children }) => children }));
vi.mock('./commercialAssistant/CommercialAssistantDrawer', () => ({ default: () => null }));
vi.mock('./navigation/NavigationContext', () => ({ NavigationProvider: ({ children }) => children }));
vi.mock('./components/layout/WorkspaceShell', () => ({ CommercialWorkspace: ({ children }) => children }));
vi.mock('./components/POForm', () => ({ default: () => <div>PO form</div> }));
vi.mock('./components/POList', () => ({ default: () => <div>PO list</div> }));
vi.mock('./components/POArchive', () => ({ default: () => <div>Archive</div> }));
vi.mock('./components/PaymentApprovalRun', () => ({ default: () => <div>Approval</div> }));
vi.mock('./components/PaymentReleaseWorklist', () => ({ default: () => <div>Release</div> }));
vi.mock('./components/CVRPortfolio', () => ({ default: () => <div>CVR</div> }));
vi.mock('./components/admin/AdministrationModule', () => ({ default: (props) => <div data-testid="admin" data-view={props.initialView || ''}>
  Admin
  {props.returnDevelopment ? <button onClick={() => props.onReturnToDevelopment(props.returnDevelopment)}>Return to {props.returnDevelopment.name}</button> : null}
</div> }));
vi.mock('./setup/setupDraft', () => ({ buildPoFormSeedFromSetup: vi.fn(), loadSetupDraft: vi.fn() }));

import App from './App';

let container;
let root;
beforeEach(() => {
  principal = { tenantReadiness: { configured: true } };
  window.history.replaceState({}, '', '/');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('GP-1 salvaged application entry', () => {
  it('lands a configured tenant on Home and uses established local development navigation', () => {
    act(() => root.render(<App />));
    expect(container.textContent).toContain('Developments & Packages');
    act(() => container.querySelector('main button').click());
    const developments = container.querySelector('[data-testid="developments"]');
    expect(developments).not.toBeNull();
    expect(developments.dataset.hasPackageTarget).toBe('false');
    expect(window.location.search).toBe('');
  });

  it('sends an unconfigured tenant or explicit setup request to Setup', () => {
    principal = { tenantReadiness: { configured: false } };
    act(() => root.render(<App />));
    expect(container.textContent).toContain('Setup Assistant');

    principal = { tenantReadiness: { configured: true } };
    window.history.replaceState({}, '', '/?setup=1');
    act(() => root.render(<App />));
    expect(container.textContent).toContain('Setup Assistant');
  });

  it('opens tenant Cost Codes with a bounded return to the originating Development', () => {
    act(() => root.render(<App />));
    act(() => container.querySelector('main button').click());
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Resolve Cost Codes').click());
    expect(container.querySelector('[data-testid="admin"]').dataset.view).toBe('cost-codes');
    expect(container.textContent).toContain('Return to Pilot Site');
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Return to Pilot Site').click());
    const developments = container.querySelector('[data-testid="developments"]');
    expect(developments.dataset.developmentId).toBe('dev-1');
    expect(developments.dataset.workspaceTab).toBe('overview');
  });
});
