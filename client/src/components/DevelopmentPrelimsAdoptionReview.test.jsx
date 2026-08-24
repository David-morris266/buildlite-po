/**
 * @vitest-environment jsdom
 * BL-033D.x.4B — Review against CVR read-only UI
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const previewDevelopmentPrelimsAdoption = vi.hoisted(() => vi.fn());
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
  previewDevelopmentPrelimsAdoption,
  DevelopmentPrelimsApiError: PrelimsApiError,
}));

import DevelopmentPrelimsAdoptionReview from './DevelopmentPrelimsAdoptionReview';

function previewDoc(overrides = {}) {
  return {
    readOnly: true,
    developmentId: 'dev-1',
    periodKey: 'P04',
    periodStatus: 'draft',
    reportingMonth: '2026-08',
    adjustmentSemantics:
      'The proposed replacement adjustment replaces the current CVR adjustment; it is not added to it.',
    accrualNote: 'Accrual is shown for context only and is not changed by this review.',
    summary: {
      resolvedPrelimsTotal: 59000,
      currentFinalForecastTotal: 50800,
      proposedFinalForecastTotal: 58000,
      deltaFinalTotal: 7200,
    },
    candidates: [
      {
        costCodeKey: '5231',
        costCodeDescription: 'Site Prelims',
        resolvedPrelimsTotal: 58000,
        unresolvedCount: 1,
        systemForecast: 50280,
        currentAdjustment: 520,
        currentFinalForecast: 50800,
        proposedAdjustment: 7720,
        proposedFinalForecast: 58000,
        deltaFinal: 7200,
        manualAccrual: 120,
        unresolvedExcludedMessage: '1 unresolved line excluded from proposed CVR value',
        unresolvedLines: [
          {
            id: 'u1',
            name: 'FIRST_COMPLETION line',
            reasonLabel: 'First completion is not set.',
            excludedFromProposal: true,
          },
        ],
        includedLines: [
          { id: 'a', name: 'Lump', totalForecast: 20000 },
          { id: 'b', name: 'Time', totalForecast: 38000 },
        ],
        flags: {
          unresolvedExposure: true,
          proposalBelowSystem: false,
          noCvrRow: false,
          cannotAdopt: false,
        },
      },
    ],
    missingFromCvr: [
      {
        costCodeKey: 'UAT-CC-001',
        costCodeDescription: 'UAT-CC-001',
        resolvedPrelimsTotal: 1000,
        unresolvedCount: 0,
        missingFromCvrMessage:
          'Cannot review against CVR — cost code is not present in the current CVR.',
        flags: { noCvrRow: true, cannotAdopt: true },
      },
    ],
    ...overrides,
  };
}

describe('DevelopmentPrelimsAdoptionReview', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    previewDevelopmentPrelimsAdoption.mockReset();
    previewDevelopmentPrelimsAdoption.mockResolvedValue(previewDoc());
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders commercial 5231 headline and replacement-adjustment semantics', async () => {
    const onBack = vi.fn();
    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={onBack} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="summary-total-resolved"]')?.textContent).toMatch(
      /59,000/
    );
    expect(container.querySelector('[data-testid="summary-reviewable"]')?.textContent).toMatch(
      /58,000/
    );
    expect(container.querySelector('[data-testid="summary-not-on-cvr"]')?.textContent).toMatch(
      /1,000/
    );
    expect(container.querySelector('[data-testid="summary-unresolved"]')?.textContent).toMatch(
      /1 unresolved line/
    );
    expect(container.querySelector('[data-testid="prelims-cvr-comparison"]')?.textContent).toMatch(
      /Current final forecast \(reviewed cost codes\)/
    );
    expect(container.querySelector('[data-testid="prelims-cvr-comparison"]')?.textContent).toMatch(
      /Proposed final forecast \(reviewed cost codes\)/
    );
    expect(container.querySelector('[data-testid="prelims-cvr-comparison"]')?.textContent).toMatch(
      /Resulting movement in final forecast/
    );
    expect(container.querySelector('[data-testid="prelims-review-card-5231"]')?.textContent).toMatch(
      /Proposed replacement adjustment/
    );
    expect(container.querySelector('[data-testid="prelims-review-card-5231"]')?.textContent).toMatch(
      /Resulting movement in final forecast/
    );
    expect(container.querySelector('[data-testid="review-hero-headline"]')?.textContent).toMatch(
      /Prelims proposal/
    );
    expect(container.querySelector('[data-testid="review-hero-headline"]')?.textContent).toMatch(
      /50,800/
    );
    expect(container.querySelector('[data-testid="review-hero-headline"]')?.textContent).toMatch(
      /58,000/
    );
    expect(container.querySelector('[data-testid="proposed-adjustment-5231"]')?.textContent).toMatch(
      /\+£7,720/
    );
    expect(container.querySelector('[data-testid="delta-final-5231"]')?.textContent).toMatch(
      /\+£7,200/
    );
    expect(container.querySelector('[data-testid="adjustment-semantics"]')?.textContent).toMatch(
      /proposed replacement adjustment replaces the current CVR adjustment/i
    );
    expect(container.querySelector('[data-testid="unresolved-block-5231"]')?.textContent).toMatch(
      /1 unresolved line excluded from proposed CVR value/i
    );
    expect(container.querySelector('[data-testid="unresolved-block-5231"]')?.textContent).toMatch(
      /not treated as £0/i
    );
    expect(container.querySelector('[data-testid="prelims-review-missing-UAT-CC-001"]')?.textContent)
      .toMatch(/not present in the current CVR/i);
    expect(container.textContent).not.toMatch(/\bAdopt\b|\bApply\b|\bConfirm adoption\b/i);
    expect(container.querySelector('[data-testid="back-to-prelims"]')).toBeTruthy();
  });

  it('Back to Prelims calls onBack and has no write controls', async () => {
    const onBack = vi.fn();
    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={onBack} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector('[data-testid="back-to-prelims"]').click();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('shows proposal-below-system warning for negative adjustment', async () => {
    previewDevelopmentPrelimsAdoption.mockResolvedValueOnce(
      previewDoc({
        candidates: [
          {
            costCodeKey: '5231',
            costCodeDescription: 'Site Prelims',
            resolvedPrelimsTotal: 58000,
            unresolvedCount: 0,
            systemForecast: 70000,
            currentAdjustment: 0,
            currentFinalForecast: 70000,
            proposedAdjustment: -12000,
            proposedFinalForecast: 58000,
            deltaFinal: -12000,
            unresolvedLines: [],
            includedLines: [],
            flags: {
              unresolvedExposure: false,
              proposalBelowSystem: true,
              noCvrRow: false,
              cannotAdopt: false,
            },
          },
        ],
        missingFromCvr: [],
      })
    );
    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="proposal-below-system"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="proposed-adjustment-5231"]')?.textContent).toMatch(
      /−£12,000|−£12,000\.00/
    );
  });
});
