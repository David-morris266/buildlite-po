/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ensureDevelopmentsReady = vi.hoisted(() => vi.fn());
const getDevelopment = vi.hoisted(() => vi.fn());
const refreshDevelopment = vi.hoisted(() => vi.fn());

vi.mock('../developments/developmentStore', () => ({
  ensureDevelopmentsReady,
  getDevelopment,
  refreshDevelopment,
}));

vi.mock('./DevelopmentWorkspace', () => ({
  default: (props) => <div
    data-testid="development-workspace"
    data-tab={props.initialActiveTab || ''}
    data-period={props.initialCvrPeriodKey || ''}
    data-package={props.initialPackageKey || ''}
  >
    Workspace
    <button type="button" onClick={() => props.onNavigationStateChange?.({ workspaceTab: 'prelims' })}>Open Prelims</button>
    <button type="button" onClick={() => props.onNavigationStateChange?.({ workspaceTab: 'selling-costs' })}>Open Selling Costs</button>
    <button type="button" onClick={() => props.onNavigationStateChange?.({ workspaceTab: 'budget' })}>Review Site Start Budget</button>
    <button type="button" onClick={() => props.onNavigationStateChange?.({ workspaceTab: 'ledger' })}>Review Purchase Ledger</button>
  </div>,
}));

vi.mock('./DevelopmentList', () => ({
  default: ({ onOpenDevelopment }) => (
    <button type="button" onClick={() => onOpenDevelopment('dev-missing')}>
      Open missing
    </button>
  ),
}));

vi.mock('./DevelopmentForm', () => ({
  default: () => <div>Development form</div>,
}));

import Developments from './Developments';

describe('Developments workspace resolving guard', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    ensureDevelopmentsReady.mockResolvedValue([]);
    getDevelopment.mockReturnValue(null);
    refreshDevelopment.mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  function renderDevelopments(props = {}) {
    act(() => {
      root.render(<Developments {...props} />);
    });
  }

  it('does not render a blank screen for an unresolved active development', async () => {
    renderDevelopments({ initialDevelopmentId: 'dev-missing' });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Resolving development');
    expect(document.body.textContent).not.toBe('');
    expect(document.querySelector('[data-testid="development-workspace"]')).toBeNull();
  });

  it('shows visible feedback and a safe return when development load fails', async () => {
    refreshDevelopment.mockRejectedValue(new Error('Development not found.'));

    renderDevelopments({ initialDevelopmentId: 'dev-missing' });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Development not found.');
    expect(document.body.textContent).toContain('Back to Developments');
  });

  it('renders the workspace once the development resolves in cache', async () => {
    refreshDevelopment.mockResolvedValue({
      id: 'dev-missing',
      developmentName: 'Test Site 1',
    });
    getDevelopment.mockImplementation((id) =>
      id === 'dev-missing'
        ? { id: 'dev-missing', developmentName: 'Test Site 1' }
        : null
    );

    renderDevelopments({ initialDevelopmentId: 'dev-missing' });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="development-workspace"]')).not.toBeNull();
  });

  it('passes canonical CVR and package identity through workspace hydration', async () => {
    const development = { id: 'dev-missing', developmentName: 'Test Site 1' };
    getDevelopment.mockReturnValue(development);
    renderDevelopments({
      initialDevelopmentId: development.id,
      initialWorkspaceTab: 'packages',
      initialPackageKey: 'dev-missing:supplier-1:3640',
      initialPackageTab: 'variations',
    });

    await act(async () => { await Promise.resolve(); });
    const workspace = document.querySelector('[data-testid="development-workspace"]');
    expect(workspace.dataset.tab).toBe('packages');
    expect(workspace.dataset.package).toBe('dev-missing:supplier-1:3640');
  });

  it('returns to the Development list when browser history restores the parent route', async () => {
    getDevelopment.mockReturnValue({ id: 'dev-missing', developmentName: 'Test Site 1' });
    renderDevelopments({ initialDevelopmentId: 'dev-missing', initialWorkspaceTab: 'prelims' });
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[data-testid="development-workspace"]')).not.toBeNull();

    renderDevelopments({ initialDevelopmentId: null, initialWorkspaceTab: null });
    expect(document.body.textContent).toContain('Open missing');
    expect(document.querySelector('[data-testid="development-workspace"]')).toBeNull();
  });

  it('converges child workspace navigation into parent state before publishing the route', async () => {
    const development = { id: 'dev-missing', developmentName: 'Test Site 1' };
    const onRouteChange = vi.fn();
    getDevelopment.mockReturnValue(development);
    renderDevelopments({ initialDevelopmentId: development.id, initialWorkspaceTab: 'overview', onRouteChange });
    await act(async () => { await Promise.resolve(); });

    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Open Prelims').click());

    expect(document.querySelector('[data-testid="development-workspace"]').dataset.tab).toBe('prelims');
    expect(onRouteChange).toHaveBeenLastCalledWith({ developmentId: development.id, workspaceTab: 'prelims' });

    renderDevelopments({ initialDevelopmentId: development.id, initialWorkspaceTab: 'overview', onRouteChange });
    expect(document.querySelector('[data-testid="development-workspace"]').dataset.tab).toBe('prelims');
  });

  it.each([
    ['Review Site Start Budget', 'budget'],
    ['Review Purchase Ledger', 'ledger'],
    ['Open Prelims', 'prelims'],
    ['Open Selling Costs', 'selling-costs'],
  ])('converges %s to the canonical %s workspace', async (buttonLabel, expectedTab) => {
    const development = { id: 'dev-missing', developmentName: 'Test Site 1' };
    getDevelopment.mockReturnValue(development);
    renderDevelopments({ initialDevelopmentId: development.id, initialWorkspaceTab: 'overview' });
    await act(async () => { await Promise.resolve(); });

    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === buttonLabel).click());

    expect(document.querySelector('[data-testid="development-workspace"]').dataset.tab).toBe(expectedTab);
  });

  it('does not carry Development A workspace state into Development B', async () => {
    getDevelopment.mockImplementation((id) => ({ id, developmentName: id }));
    renderDevelopments({ initialDevelopmentId: 'dev-a', initialWorkspaceTab: 'prelims' });
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[data-testid="development-workspace"]').dataset.tab).toBe('prelims');

    renderDevelopments({ initialDevelopmentId: 'dev-b', initialWorkspaceTab: 'overview' });
    expect(document.querySelector('[data-testid="development-workspace"]').dataset.tab).toBe('overview');
  });

  it('fails an invalid hydrated workspace safely to Overview', async () => {
    getDevelopment.mockReturnValue({ id: 'dev-missing', developmentName: 'Test Site 1' });
    renderDevelopments({ initialDevelopmentId: 'dev-missing', initialWorkspaceTab: 'not-a-workspace' });
    await act(async () => { await Promise.resolve(); });

    expect(document.querySelector('[data-testid="development-workspace"]').dataset.tab).toBe('overview');
  });
});
