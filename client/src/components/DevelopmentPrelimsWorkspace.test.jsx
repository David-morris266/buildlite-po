/**
 * @vitest-environment jsdom
 * BL-033D.x.5 — Prelims landing-page UX consolidation
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
  adoptDevelopmentPrelimsIntoCvr: vi.fn(),
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
  const proto =
    element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const native = Object.getOwnPropertyDescriptor(proto, 'value').set;
  native.call(element, value);
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

describe('DevelopmentPrelimsWorkspace (x.5 landing + add/edit)', () => {
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

  async function openManualForm() {
    await act(async () => {
      container.querySelector('[data-testid="add-site-specific-prelim"]').click();
    });
  }

  async function submitForm() {
    await act(async () => {
      container.querySelector('[data-testid="manual-prelims-form"]').dispatchEvent(
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
                payload.forecastDriver === 'LUMP_SUM' ? lumpItem().calculation : item.calculation,
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

  it('hides manual form initially and shows Add site-specific Prelim near primary actions', async () => {
    stored = [timeItem()];
    await renderWorkspace();
    expect(container.querySelector('[data-testid="manual-prelims-form"]')).toBeNull();
    expect(container.querySelector('[data-testid="add-site-specific-prelim"]')).toBeTruthy();
    expect(container.textContent).toMatch(/\+ Add site-specific Prelim/);
    expect(container.textContent).not.toMatch(/Add Prelims line/);
    // Secondary action sits in the primary action block, before cost-code cards.
    const primary = container.querySelector('[data-testid="prelims-primary-actions"]');
    const secondary = container.querySelector('[data-testid="prelims-secondary-actions"]');
    const cards = container.querySelector('[data-testid="prelims-group-5231"]');
    expect(primary.contains(secondary)).toBe(true);
    expect(
      primary.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(createDevelopmentPrelimsItem).not.toHaveBeenCalled();
    expect(updateDevelopmentPrelimsItem).not.toHaveBeenCalled();
  });

  it('uses Set up site Prelims when no lines exist', async () => {
    await renderWorkspace();
    expect(container.querySelector('[data-testid="setup-site-prelims"]')?.textContent).toBe(
      'Set up site Prelims'
    );
    expect(container.querySelector('[data-testid="prelims-setup-supporting"]')?.textContent).toMatch(
      /create the site forecast/i
    );
    expect(container.textContent).not.toMatch(/Manage site Prelims/);
  });

  it('uses Manage site Prelims when lines already exist', async () => {
    stored = [timeItem()];
    await renderWorkspace();
    expect(container.querySelector('[data-testid="setup-site-prelims"]')?.textContent).toBe(
      'Manage site Prelims'
    );
    expect(container.querySelector('[data-testid="prelims-setup-supporting"]')?.textContent).toMatch(
      /add or update site assumptions/i
    );
    expect(container.textContent).not.toMatch(/Set up site Prelims/);
  });

  it('Manage site Prelims opens the same template worksheet', async () => {
    stored = [timeItem()];
    await renderWorkspace();
    expect(container.querySelector('[data-testid="setup-site-prelims"]')?.textContent).toBe(
      'Manage site Prelims'
    );
    await act(async () => {
      container.querySelector('[data-testid="setup-site-prelims"]').click();
    });
    expect(container.querySelector('[data-testid="mock-prelims-setup"]')).toBeTruthy();
  });

  it('reveals the existing manual form on Add site-specific Prelim', async () => {
    await renderWorkspace();
    await openManualForm();
    const form = container.querySelector('[data-testid="manual-prelims-form"]');
    expect(form).toBeTruthy();
    expect(form.getAttribute('data-mode')).toBe('add');
    expect(container.querySelector('[aria-label="Prelims cost code"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Prelims forecast driver"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="add-site-specific-prelim"]')).toBeNull();
    expect(createDevelopmentPrelimsItem).not.toHaveBeenCalled();
  });

  it('Cancel hides the form without writing', async () => {
    await renderWorkspace();
    await openManualForm();
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Prelims cost code"]'), '5231');
      setInputValue(container.querySelector('[aria-label="Prelims line name"]'), 'Draft only');
    });
    await act(async () => {
      container.querySelector('[data-testid="cancel-manual-entry"]').click();
    });
    expect(container.querySelector('[data-testid="manual-prelims-form"]')).toBeNull();
    expect(container.querySelector('[data-testid="add-site-specific-prelim"]')).toBeTruthy();
    expect(createDevelopmentPrelimsItem).not.toHaveBeenCalled();
    expect(updateDevelopmentPrelimsItem).not.toHaveBeenCalled();
    expect(listDevelopmentPrelimsItems).toHaveBeenCalledTimes(1);
  });

  it('keeps proposal cards visible without opening setup', async () => {
    stored = [timeItem(), lumpItem()];
    await renderWorkspace();
    expect(container.querySelector('[data-testid="prelims-group-5231"]')).toBeTruthy();
    expect(container.textContent).toMatch(/BL-033D.1 TIME UAT/);
    expect(container.textContent).toMatch(/BL-033D.1 LUMP SUM UAT/);
    expect(container.querySelector('[data-testid="mock-prelims-setup"]')).toBeNull();
    expect(container.querySelector('[data-testid="manual-prelims-form"]')).toBeNull();
  });

  it('Set up site Prelims opens the template worksheet', async () => {
    await renderWorkspace();
    expect(container.querySelector('[data-testid="setup-site-prelims"]')?.textContent).toBe(
      'Set up site Prelims'
    );
    await act(async () => {
      container.querySelector('[data-testid="setup-site-prelims"]').click();
    });
    expect(container.querySelector('[data-testid="mock-prelims-setup"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="review-against-cvr"]')).toBeNull();
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
    expect(container.querySelector('[data-testid="manual-prelims-form"]')).toBeNull();
    await act(async () => {
      container.querySelector('[data-testid="back-to-prelims"]').click();
    });
    expect(container.querySelector('[data-testid="review-against-cvr"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="add-site-specific-prelim"]')).toBeTruthy();
  });

  it('shows proposal-only banner and primary setup copy', async () => {
    await renderWorkspace();
    expect(container.textContent).toMatch(/Prelims proposal only/);
    expect(container.textContent).toMatch(/do not change the CVR until you review/i);
    expect(container.textContent).toMatch(/explicitly confirm adoption/i);
    expect(container.textContent).toMatch(/company Prelims template/i);
    expect(container.textContent).toMatch(/Set up site Prelims/);
    expect(container.textContent).toMatch(/CVR reporting month 2026-08/);
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
    expect(container.querySelector('[data-testid="prelims-group-5231"]')).toBeTruthy();
  });

  it('creates a TIME line with POST, then collapses manual entry', async () => {
    await renderWorkspace();
    await openManualForm();
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
    expect(container.querySelector('[data-testid="manual-prelims-form"]')).toBeNull();
    expect(container.querySelector('[data-testid="add-site-specific-prelim"]')).toBeTruthy();
    expect(container.textContent).toMatch(/BL-033D.1 TIME UAT/);
  });

  it('creates a LUMP_SUM line with TIME/LUMP controls intact', async () => {
    await renderWorkspace();
    await openManualForm();
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Prelims cost code"]'), '5231');
      setInputValue(container.querySelector('[aria-label="Prelims line name"]'), 'BL-033D.1 TIME UAT');
    });
    await submitForm();

    await openManualForm();
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
    expect(createDevelopmentPrelimsItem.mock.calls[1][1].forecastDriver).toBe('LUMP_SUM');
    expect(stored).toHaveLength(2);
    expect(container.textContent).toMatch(/£58,000/);
    expect(container.querySelector('[data-testid="manual-prelims-form"]')).toBeNull();
  });

  it('Edit opens the form and PUTs that id; cancel collapses without write', async () => {
    stored = [timeItem(), lumpItem()];
    await renderWorkspace();
    await act(async () => {
      container.querySelector('[aria-label="Edit BL-033D.1 TIME UAT"]').click();
    });
    expect(container.querySelector('[data-testid="manual-prelims-form"]')?.getAttribute('data-mode')).toBe(
      'edit'
    );
    expect(container.textContent).toMatch(/Editing: BL-033D.1 TIME UAT/);

    await act(async () => {
      container.querySelector('[data-testid="cancel-manual-entry"]').click();
    });
    expect(container.querySelector('[data-testid="manual-prelims-form"]')).toBeNull();
    expect(updateDevelopmentPrelimsItem).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector('[aria-label="Edit BL-033D.1 TIME UAT"]').click();
    });
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Prelims monthly rate"]'), '1200');
    });
    await submitForm();

    expect(updateDevelopmentPrelimsItem).toHaveBeenCalledTimes(1);
    expect(updateDevelopmentPrelimsItem.mock.calls[0][1]).toBe('time-1');
    expect(updateDevelopmentPrelimsItem.mock.calls[0][2].monthlyRate).toBe(1200);
    expect(container.querySelector('[data-testid="manual-prelims-form"]')).toBeNull();
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
    expect(stored.find((item) => item.id === 'lump-sibling').lumpSumAmount).toBe(20000);
  });

  it('keeps Add form open after a failed create', async () => {
    createDevelopmentPrelimsItem.mockRejectedValueOnce(new PrelimsApiError('nope', { status: 400 }));
    await renderWorkspace();
    await openManualForm();
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Prelims cost code"]'), '5231');
      setInputValue(container.querySelector('[aria-label="Prelims line name"]'), 'Failed add');
    });
    await submitForm();
    expect(container.querySelector('[data-testid="manual-prelims-form"]')?.getAttribute('data-mode')).toBe(
      'add'
    );
    expect(container.querySelector('[aria-label="Prelims line name"]').value).toBe('Failed add');
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
    expect(container.querySelector('[data-testid="manual-prelims-form"]')?.getAttribute('data-mode')).toBe(
      'edit'
    );
    expect(container.textContent).toMatch(/Editing: BL-033D.1 TIME UAT/);
    expect(container.textContent).toMatch(/updated elsewhere/);
  });
});
