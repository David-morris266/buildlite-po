/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ensureDevelopmentsReady = vi.hoisted(() => vi.fn());
const listPOs = vi.hoisted(() => vi.fn());
const buildCvrPortfolioModel = vi.hoisted(() => vi.fn());

vi.mock('../developments/developmentStore', () => ({
  ensureDevelopmentsReady,
  listDevelopments: vi.fn(() => []),
}));

vi.mock('../api', () => ({
  listPOs,
}));

vi.mock('../cvr/cvrPeriodHelpers', () => ({
  buildCvrPortfolioModel,
}));

vi.mock('../cvr/cvrPeriodStore', () => ({
  approveCvrPeriod: vi.fn(),
  rejectCvrPeriod: vi.fn(),
}));

import CVRPortfolio from './CVRPortfolio';

const samplePortfolio = {
  summaryCards: [{ label: 'Developments', value: '1', modifier: 'default' }],
  awaitingApproval: [],
  rows: [
    {
      developmentId: 'dev-1',
      developmentName: 'Test Site 1',
      developmentNumber: 'TS1',
      currentPeriodKey: '2026-01',
      status: { label: 'Draft', modifier: 'draft' },
      forecastLabel: '£100,000',
      varianceLabel: '£0',
    },
  ],
};

describe('CVRPortfolio development loading guard', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listPOs.mockResolvedValue([]);
    buildCvrPortfolioModel.mockReturnValue(samplePortfolio);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  function renderPortfolio(props = {}) {
    act(() => {
      root.render(<CVRPortfolio {...props} />);
    });
  }

  it('shows loading state on initial mount without dereferencing portfolio', async () => {
    let resolveReady;
    ensureDevelopmentsReady.mockReturnValue(
      new Promise((resolve) => {
        resolveReady = resolve;
      })
    );

    renderPortfolio();

    expect(document.body.textContent).toContain('Loading CVR portfolio');
    expect(document.body.textContent).toContain('CVR Portfolio');
    expect(document.body.textContent).not.toContain('No developments found.');

    await act(async () => {
      resolveReady([]);
      await Promise.resolve();
    });

    expect(buildCvrPortfolioModel).toHaveBeenCalled();
    expect(document.body.textContent).toContain('Test Site 1');
  });

  it('renders CVR content after development readiness resolves', async () => {
    ensureDevelopmentsReady.mockResolvedValue([]);

    renderPortfolio();
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Test Site 1');
    expect(document.body.textContent).toContain('Developments');
    expect(document.body.textContent).toContain('Awaiting Approval');
  });

  it('shows a clear error state when ensureDevelopmentsReady rejects', async () => {
    ensureDevelopmentsReady.mockRejectedValue(
      new Error('Unable to load Developments for the CVR. Please refresh and try again.')
    );

    renderPortfolio();
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      'Unable to load Developments for the CVR. Please refresh and try again.'
    );
    expect(document.body.textContent).not.toContain('Loading CVR portfolio');
  });

  it('renders a valid empty state when no developments exist', async () => {
    ensureDevelopmentsReady.mockResolvedValue([]);
    buildCvrPortfolioModel.mockReturnValue({
      summaryCards: [{ label: 'Developments', value: '0', modifier: 'default' }],
      awaitingApproval: [],
      rows: [],
    });

    renderPortfolio();
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('No developments found.');
  });

  it('keeps portfolio calculations delegated to buildCvrPortfolioModel unchanged', async () => {
    ensureDevelopmentsReady.mockResolvedValue([]);
    listPOs.mockResolvedValue([{ poNumber: 'S0001', type: 'S', status: 'Approved' }]);

    renderPortfolio();
    await act(async () => {
      await Promise.resolve();
    });

    expect(buildCvrPortfolioModel).toHaveBeenCalledWith([
      { poNumber: 'S0001', type: 'S', status: 'Approved' },
    ]);
  });

  it('mounts cleanly after developments were already resolved elsewhere', async () => {
    ensureDevelopmentsReady.mockResolvedValue([]);

    renderPortfolio();
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      root.unmount();
    });

    root = createRoot(container);
    renderPortfolio();
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Test Site 1');
  });

  it('does not update state after unmount when readiness resolves late', async () => {
    let resolveReady;
    ensureDevelopmentsReady.mockReturnValue(
      new Promise((resolve) => {
        resolveReady = resolve;
      })
    );

    renderPortfolio();
    act(() => {
      root.unmount();
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      resolveReady([]);
      await Promise.resolve();
    });

    expect(
      errorSpy.mock.calls.some(([message]) =>
        String(message).includes('Cannot update a component while rendering')
      )
    ).toBe(false);
    expect(
      errorSpy.mock.calls.some(([message]) =>
        String(message).includes("Can't perform a React state update on an unmounted component")
      )
    ).toBe(false);

    errorSpy.mockRestore();
  });
});

describe('CVR certified lookup contract', () => {
  it('continues to rely on orderKey-based CVR engine helpers, not package UUID', async () => {
    const { calculatePackageCertifiedValue } = await import('../cvr/cvrCertifiedValue');
    expect(typeof calculatePackageCertifiedValue).toBe('function');
    expect(calculatePackageCertifiedValue.length).toBe(1);
  });
});
