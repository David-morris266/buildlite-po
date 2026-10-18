/* @vitest-environment jsdom */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const loadDashboard = vi.fn();
let principal = { user: { displayName: 'David Morris' }, activeTenant: { clientId: 'tenant-1', name: 'Hawthorn' }, permissions: [] };
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePrincipal: () => principal }));
vi.mock('../api/homeDashboard', () => ({ getHomeDashboard: () => loadDashboard() }));
import BuildLiteHome from './BuildLiteHome';

const response = {
  generatedAt: '2026-10-18T10:00:00Z',
  overview: { state: 'ready', metrics: {
    liveDevelopments: { state: 'ready', value: 3 }, cvrAwaitingApproval: { state: 'ready', value: 2 },
    certificatesRequiringReview: { state: 'restricted' }, openCommercialEvents: { state: 'ready', value: 7 },
  } },
  attention: { state: 'ready', displayLimit: 8, total: null, limitedSelection: true, items: [{ id: 'cvr:1', type: 'CVR', title: 'Oak Meadow · P03', detail: 'Submitted', status: 'Awaiting approval', destination: { view: 'developments', developmentId: 'dev-1', workspaceTab: 'cvr', periodKey: 'P03' } }] },
  activity: { state: 'ready', items: [{ id: 'po:1', type: 'purchase_order', title: 'Purchase Order S0214', action: 'issued', actor: 'Alex Morgan', timestamp: '2026-10-18T09:00:00Z', destination: { view: 'purchase-orders', poNumber: 'S0214' } }] },
};

let container; let root;
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); container = null; root = null; loadDashboard.mockReset(); });
async function renderHome(onNavigate = vi.fn()) {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); await act(async () => root.render(<BuildLiteHome onNavigate={onNavigate} />));
  return { onNavigate, text: () => container.textContent, buttons: () => [...container.querySelectorAll('button')] };
}

describe('BuildLite Home commercial dashboard', () => {
  it('renders real dashboard sections without duplicate navigation cards', async () => {
    loadDashboard.mockResolvedValue(response);
    const view = await renderHome();
    expect(view.text()).toContain('Commercial overview');
    expect(view.text()).toContain('Live Developments3');
    expect(view.text()).not.toContain('Certificates Requiring Review');
    expect(view.text()).toContain('Your Attention Required');
    expect(view.text()).toContain('Limited selection · up to 8');
    expect(view.text()).not.toContain('12.4%');
    expect(view.text()).not.toContain('+£240k');
    expect(view.text()).toContain('Recent Activity');
    expect(view.text()).not.toContain('Developments & Packages');
    expect(view.text()).toContain('David Morris');
    expect(view.text()).toContain('Company: Hawthorn');
  });

  it('opens canonical destinations supplied by the server', async () => {
    loadDashboard.mockResolvedValue(response);
    const view = await renderHome();
    const approval = view.buttons().find(button => button.textContent === 'Awaiting approval');
    act(() => approval.click());
    expect(view.onNavigate).toHaveBeenCalledWith(response.attention.items[0].destination);
  });

  it('shows honest partial and unavailable states instead of zero', async () => {
    loadDashboard.mockResolvedValue({ ...response, overview: { state: 'partial', metrics: { ...response.overview.metrics, liveDevelopments: { state: 'unavailable', message: 'Temporarily unavailable.' } } }, attention: { state: 'partial', items: [], unavailableSources: ['accounts'] }, activity: { state: 'unavailable', items: [], message: 'Recent activity is temporarily unavailable.' } });
    const view = await renderHome();
    expect(view.text()).toContain('Live Developments—Temporarily unavailable.');
    expect(view.text()).toContain('Some worklists are temporarily unavailable.');
    expect(view.text()).toContain('Recent activity is temporarily unavailable.');
  });

  it('keeps the Financial Data Flow decorative and handles a full endpoint error', async () => {
    loadDashboard.mockRejectedValue(new Error('Dashboard failed safely.'));
    const view = await renderHome();
    expect(container.querySelector('.buildlite-home__header > .buildlite-home__flow')).toBeTruthy();
    expect(container.querySelectorAll('.buildlite-home__flow-wave')).toHaveLength(3);
    expect(container.querySelectorAll('.buildlite-home__flow-particles')).toHaveLength(2);
    expect(container.querySelector('.buildlite-home__flow[aria-hidden="true"]')).toBeTruthy();
    expect(view.text()).toContain('Dashboard failed safely.');
  });
});
