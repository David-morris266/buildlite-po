/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listDevelopmentPrelimsItems = vi.hoisted(() => vi.fn());
const createDevelopmentPrelimsItem = vi.hoisted(() => vi.fn());
const updateDevelopmentPrelimsItem = vi.hoisted(() => vi.fn());
const getCostCodeClassification = vi.hoisted(() => vi.fn());
const listCostCodes = vi.hoisted(() => vi.fn());
const PrelimsApiError = vi.hoisted(() => {
  return class DevelopmentPrelimsApiError extends Error {
    constructor(message, { status = 0 } = {}) {
      super(message);
      this.name = 'DevelopmentPrelimsApiError';
      this.status = status;
    }
  };
});

vi.mock('../api/developmentPrelimsItems', () => ({
  listDevelopmentPrelimsItems,
  createDevelopmentPrelimsItem,
  updateDevelopmentPrelimsItem,
  previewDevelopmentPrelimsSetup: vi.fn(),
  applyDevelopmentPrelimsSetup: vi.fn(),
  previewDevelopmentPrelimsAdoption: vi.fn(async () => ({
    readOnly: true,
    periodKey: 'P04',
    reportingMonth: '2026-08',
    summary: {},
    candidates: [],
    missingFromCvr: [],
  })),
  DevelopmentPrelimsApiError: PrelimsApiError,
}));

vi.mock('./DevelopmentPrelimsSetupWorksheet', () => ({
  default: function MockSetup({ onCancel }) {
    return (
      <div data-testid="mock-prelims-setup">
        <button type="button" onClick={onCancel}>
          Cancel setup
        </button>
      </div>
    );
  },
}));

vi.mock('./DevelopmentPrelimsAdoptionReview', () => ({
  default: function MockReview({ onBack }) {
    return (
      <div data-testid="mock-prelims-review">
        <button type="button" data-testid="back-to-prelims" onClick={onBack}>
          Back to Prelims
        </button>
      </div>
    );
  },
}));

vi.mock('../api/costCodeClassifications', () => ({
  getCostCodeClassification,
}));

vi.mock('../api', () => ({
  listCostCodes,
}));

import DevelopmentPrelimsWorkspace from './DevelopmentPrelimsWorkspace';

function timeItem(overrides = {}) {
  return {
    id: 'time-1',
    version: 1,
    costCodeKey: '5231',
    name: 'BL-033D.1 TIME UAT',
    forecastDriver: 'TIME',
    status: 'active',
    monthlyRate: 1000,
    startBasis: 'SITE_START',
    startFixedDate: null,
    endBasis: 'FINAL_COMPLETION',
    endFixedDate: null,
    lumpSumAmount: null,
    calculation: {
      state: 'resolved',
      totalForecast: 38000,
      forecastToDate: 0,
      forecastToComplete: 38000,
      remainingExposure: 38000,
      includedInActiveProposal: true,
      totalMonths: 38,
      elapsedMonths: 0,
      remainingMonths: 38,
      resolvedStart: '2026-09-01',
      resolvedEnd: '2029-10-01',
    },
    ...overrides,
  };
}

function lumpItem(overrides = {}) {
  return {
    id: 'lump-1',
    version: 1,
    costCodeKey: '5231',
    name: 'BL-033D.1 LUMP SUM UAT',
    forecastDriver: 'LUMP_SUM',
    status: 'active',
    monthlyRate: null,
    startBasis: null,
    lumpSumAmount: 20000,
    calculation: {
      state: 'resolved',
      totalForecast: 20000,
      assumptionAmount: 20000,
      remainingExposure: 20000,
      includedInActiveProposal: true,
    },
    ...overrides,
  };
}

function collectionFor(items) {
  const hasTime = items.some((item) => item.id === 'time-1' && item.forecastDriver === 'TIME');
  const hasLump = items.some((item) => item.forecastDriver === 'LUMP_SUM' && item.status === 'active');
  const activeProposal = (hasTime ? 38000 : 0) + (hasLump ? 20000 : 0);
  return {
    developmentId: 'dev-1',
    proposalOnly: true,
    adoptedIntoCvr: false,
    reportingMonth: '2026-08',
    programme: {
      exists: true,
      siteStart: '2026-09-01',
      firstCompletion: null,
      finalCompletion: '2029-10-01',
      version: 1,
    },
    items,
    summary: {
      byCostCode: items.length
        ? [
            {
              costCodeKey: '5231',
              lineCount: items.length,
              activeProposal,
              hasUnresolved: false,
            },
          ]
        : [],
      development: {
        activeProposal: items.length ? activeProposal : 0,
        hasUnresolved: false,
        unresolvedCount: 0,
      },
    },
  };
}

function setInputValue(element, value) {
  const proto = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const native = Object.getOwnPropertyDescriptor(proto, 'value').set;
  native.call(element, value);
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

describe('DevelopmentPrelimsWorkspace add vs edit', () => {
  let container;
  let root;
  let stored;

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function renderWorkspace() {
    await act(async () => {
      root.render(<DevelopmentPrelimsWorkspace developmentId="dev-1" />);
    });
    await flush();
  }

  async function submitForm() {
    await act(async () => {
      container.querySelector('form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    stored = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listCostCodes.mockResolvedValue([{ code: '5231', description: 'Preliminaries' }]);
    getCostCodeClassification.mockResolvedValue({
      forecastDriver: 'STANDARD_CVR',
      semanticGroup: 'PRELIMS',
    });
    listDevelopmentPrelimsItems.mockImplementation(async () => collectionFor(stored));
    createDevelopmentPrelimsItem.mockImplementation(async (_dev, payload) => {
      const item =
        payload.forecastDriver === 'LUMP_SUM'
          ? lumpItem({
              name: payload.name,
              lumpSumAmount: payload.lumpSumAmount,
              version: 1,
            })
          : timeItem({
              name: payload.name,
              monthlyRate: payload.monthlyRate,
              version: 1,
            });
      stored = [...stored, item];
      return item;
    });
    updateDevelopmentPrelimsItem.mockImplementation(async (_dev, itemId, payload) => {
      stored = stored.map((item) =>
        item.id === itemId
          ? {
              ...item,
              ...payload,
              id: itemId,
              version: item.version + 1,
              monthlyRate: payload.forecastDriver === 'TIME' ? payload.monthlyRate : null,
              startBasis: payload.forecastDriver === 'TIME' ? payload.startBasis : null,
              endBasis: payload.forecastDriver === 'TIME' ? payload.endBasis : null,
              lumpSumAmount: payload.forecastDriver === 'LUMP_SUM' ? payload.lumpSumAmount : null,
              calculation:
                payload.forecastDriver === 'LUMP_SUM'
                  ? lumpItem().calculation
                  : item.calculation,
            }
          : item
      );
      return stored.find((item) => item.id === itemId);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it('shows Review against CVR and opens the review view', async () => {
    await renderWorkspace();
    expect(container.textContent).toMatch(/Review against CVR/);
    expect(container.textContent).not.toMatch(/Review & Adopt/);
    expect(container.querySelector('[data-testid="review-against-cvr"]')).toBeTruthy();
    await act(async () => {
      container.querySelector('[data-testid="review-against-cvr"]').click();
    });
    expect(container.querySelector('[data-testid="mock-prelims-review"]')).toBeTruthy();
    expect(container.querySelector('form')).toBeNull();
    await act(async () => {
      container.querySelector('[data-testid="back-to-prelims"]').click();
    });
    expect(container.querySelector('[data-testid="review-against-cvr"]')).toBeTruthy();
    expect(container.querySelector('form')).toBeTruthy();
  });

  it('shows a proposal-only banner, a setup worksheet entry, and no Review & Adopt control', async () => {
    await renderWorkspace();
    expect(container.textContent).toMatch(/Prelims proposal only/);
    expect(container.textContent).toMatch(/do not change the CVR until you review/i);
    expect(container.textContent).toMatch(/explicitly confirm adoption/i);
    expect(container.textContent).not.toMatch(/Review & Adopt/);
    expect(container.textContent).toMatch(/Review against CVR/);
    expect(container.textContent).toMatch(/Set up site Prelims/);
    expect(container.textContent).toMatch(/CVR reporting month 2026-08/);
    expect(container.querySelector('form').getAttribute('data-mode')).toBe('add');
  });

  it('shows resolved proposal and unresolved count separately', async () => {
    stored = [
      timeItem(),
      lumpItem(),
      timeItem({
        id: 'time-unresolved',
        name: 'Unresolved FIRST_COMPLETION',
        calculation: {
          state: 'unresolved',
          reason: 'FIRST_COMPLETION',
          reasonLabel: 'First completion date missing',
          includedInActiveProposal: false,
        },
      }),
    ];
    listDevelopmentPrelimsItems.mockResolvedValueOnce({
      ...collectionFor(stored),
      summary: {
        byCostCode: [
          {
            costCodeKey: '5231',
            lineCount: 3,
            activeProposal: 58000,
            hasUnresolved: true,
            unresolvedCount: 1,
          },
        ],
        development: {
          activeProposal: 58000,
          hasUnresolved: true,
          unresolvedCount: 1,
        },
      },
    });
    await renderWorkspace();
    expect(container.textContent).toMatch(/Resolved proposal £58,000\.00 · 1 unresolved line/);
    expect(container.textContent).not.toMatch(/includes unresolved lines/i);
    expect(container.textContent).not.toMatch(/Active proposal total/i);
  });

  it('creates a TIME line with POST, returns to Add mode, and does not PUT', async () => {
    await renderWorkspace();
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Prelims cost code"]'), '5231');
      setInputValue(container.querySelector('[aria-label="Prelims line name"]'), 'BL-033D.1 TIME UAT');
    });
    await submitForm();

    expect(createDevelopmentPrelimsItem).toHaveBeenCalledTimes(1);
    expect(updateDevelopmentPrelimsItem).not.toHaveBeenCalled();
    const payload = createDevelopmentPrelimsItem.mock.calls[0][1];
    expect(payload.version).toBe(0);
    expect(payload.forecastDriver).toBe('TIME');
    expect(payload.monthlyRate).toBe(1000);
    expect(payload.startBasis).toBe('SITE_START');
    expect(payload.endBasis).toBe('FINAL_COMPLETION');
    expect(stored[0].version).toBe(1);
    expect(container.querySelector('form').getAttribute('data-mode')).toBe('add');
    expect(container.textContent).toMatch(/Add Prelims line/);
    expect(container.querySelector('[aria-label="Prelims cost code"]').value).toBe('');
    expect(container.querySelector('[aria-label="Prelims line name"]').value).toBe('');
    expect(container.textContent).toMatch(/BL-033D.1 TIME UAT/);
  });

  it('creates a second LUMP_SUM line on the same cost code with another POST', async () => {
    await renderWorkspace();
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Prelims cost code"]'), '5231');
      setInputValue(container.querySelector('[aria-label="Prelims line name"]'), 'BL-033D.1 TIME UAT');
    });
    await submitForm();

    const firstId = stored[0].id;
    const firstName = stored[0].name;
    const firstDriver = stored[0].forecastDriver;

    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Prelims cost code"]'), '5231');
      setInputValue(container.querySelector('[aria-label="Prelims line name"]'), 'BL-033D.1 LUMP SUM UAT');
      setInputValue(container.querySelector('[aria-label="Prelims forecast driver"]'), 'LUMP_SUM');
    });
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Prelims lump-sum amount"]'), '20000');
    });
    await submitForm();

    expect(createDevelopmentPrelimsItem).toHaveBeenCalledTimes(2);
    expect(updateDevelopmentPrelimsItem).not.toHaveBeenCalled();
    expect(createDevelopmentPrelimsItem.mock.calls[1][1].forecastDriver).toBe('LUMP_SUM');
    expect(createDevelopmentPrelimsItem.mock.calls[1][1].version).toBe(0);
    expect(stored).toHaveLength(2);
    expect(stored[0].id).toBe(firstId);
    expect(stored[0].name).toBe(firstName);
    expect(stored[0].forecastDriver).toBe(firstDriver);
    expect(stored[1].id).not.toBe(firstId);
    expect(container.textContent).toMatch(/BL-033D.1 TIME UAT/);
    expect(container.textContent).toMatch(/BL-033D.1 LUMP SUM UAT/);
    expect(container.textContent).toMatch(/£38,000/);
    expect(container.textContent).toMatch(/£20,000/);
    expect(container.textContent).toMatch(/£58,000/);
    expect(container.querySelector('form').getAttribute('data-mode')).toBe('add');
  });

  it('enters Edit mode only from Edit and PUTs that id', async () => {
    stored = [timeItem(), lumpItem()];
    await renderWorkspace();
    await act(async () => {
      container.querySelector('[aria-label="Edit BL-033D.1 TIME UAT"]').click();
    });
    expect(container.querySelector('form').getAttribute('data-mode')).toBe('edit');
    expect(container.textContent).toMatch(/Editing: BL-033D.1 TIME UAT/);

    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Prelims monthly rate"]'), '1200');
    });
    await submitForm();

    expect(updateDevelopmentPrelimsItem).toHaveBeenCalledTimes(1);
    expect(createDevelopmentPrelimsItem).not.toHaveBeenCalled();
    expect(updateDevelopmentPrelimsItem.mock.calls[0][1]).toBe('time-1');
    expect(updateDevelopmentPrelimsItem.mock.calls[0][2].monthlyRate).toBe(1200);
    expect(stored.find((item) => item.id === 'lump-1').lumpSumAmount).toBe(20000);
    expect(container.querySelector('form').getAttribute('data-mode')).toBe('add');
  });

  it('changing TIME to LUMP_SUM while editing overwrites only that row', async () => {
    stored = [timeItem(), lumpItem({ id: 'lump-sibling', name: 'Sibling lump' })];
    await renderWorkspace();
    await act(async () => {
      container.querySelector('[aria-label="Edit BL-033D.1 TIME UAT"]').click();
    });
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Prelims forecast driver"]'), 'LUMP_SUM');
    });
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Prelims lump-sum amount"]'), '15000');
    });
    await submitForm();

    expect(updateDevelopmentPrelimsItem).toHaveBeenCalledTimes(1);
    expect(updateDevelopmentPrelimsItem.mock.calls[0][1]).toBe('time-1');
    expect(updateDevelopmentPrelimsItem.mock.calls[0][2].forecastDriver).toBe('LUMP_SUM');
    expect(stored.find((item) => item.id === 'time-1').forecastDriver).toBe('LUMP_SUM');
    expect(stored.find((item) => item.id === 'time-1').monthlyRate).toBeNull();
    expect(stored.find((item) => item.id === 'lump-sibling').name).toBe('Sibling lump');
    expect(stored.find((item) => item.id === 'lump-sibling').lumpSumAmount).toBe(20000);
  });

  it('Cancel edit returns to Add mode so the next save is POST', async () => {
    stored = [timeItem()];
    await renderWorkspace();
    await act(async () => {
      container.querySelector('[aria-label="Edit BL-033D.1 TIME UAT"]').click();
    });
    await act(async () => {
      [...container.querySelectorAll('button')].find((btn) => btn.textContent === 'Cancel edit').click();
    });
    expect(container.querySelector('form').getAttribute('data-mode')).toBe('add');
    expect(container.textContent).toMatch(/Add Prelims line/);
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Prelims cost code"]'), '5231');
      setInputValue(container.querySelector('[aria-label="Prelims line name"]'), 'Second line');
    });
    await submitForm();
    expect(createDevelopmentPrelimsItem).toHaveBeenCalledTimes(1);
    expect(updateDevelopmentPrelimsItem).not.toHaveBeenCalled();
  });

  it('keeps Add mode after a failed create', async () => {
    createDevelopmentPrelimsItem.mockRejectedValueOnce(new PrelimsApiError('nope', { status: 400 }));
    await renderWorkspace();
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Prelims cost code"]'), '5231');
      setInputValue(container.querySelector('[aria-label="Prelims line name"]'), 'Failed add');
    });
    await submitForm();
    expect(container.querySelector('form').getAttribute('data-mode')).toBe('add');
    expect(container.querySelector('[aria-label="Prelims line name"]').value).toBe('Failed add');
    expect(updateDevelopmentPrelimsItem).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/nope/);
  });

  it('keeps Edit mode after a failed update', async () => {
    stored = [timeItem()];
    updateDevelopmentPrelimsItem.mockRejectedValueOnce(new PrelimsApiError('stale', { status: 409 }));
    await renderWorkspace();
    await act(async () => {
      container.querySelector('[aria-label="Edit BL-033D.1 TIME UAT"]').click();
    });
    await submitForm();
    expect(container.querySelector('form').getAttribute('data-mode')).toBe('edit');
    expect(container.textContent).toMatch(/Editing: BL-033D.1 TIME UAT/);
    expect(container.textContent).toMatch(/updated elsewhere/);
    expect(createDevelopmentPrelimsItem).not.toHaveBeenCalled();
  });
});
