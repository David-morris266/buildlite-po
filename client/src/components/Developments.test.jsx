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
  default: () => <div data-testid="development-workspace">Workspace</div>,
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
});
