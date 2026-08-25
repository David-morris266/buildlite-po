/**
 * @vitest-environment jsdom
 * BL-034C — Read-only Selling Costs Review against CVR
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import DevelopmentSellingCostsCvrReview from './DevelopmentSellingCostsCvrReview';

vi.mock('../api/sellingCosts', () => ({
  SellingCostsApiError: class SellingCostsApiError extends Error {
    constructor(message, { status = 0, body = null } = {}) {
      super(message);
      this.name = 'SellingCostsApiError';
      this.status = status;
      this.body = body;
    }
  },
  getSellingCostsCvrReview: vi.fn(),
}));

import { getSellingCostsCvrReview } from '../api/sellingCosts';

const readyPreview = {
  readOnly: true,
  canAdopt: false,
  reviewStatus: 'ready',
  reviewState: 'not_adopted',
  blockedReason: null,
  headline:
    'BuildLite currently proposes £182,780.64 of Selling Costs. The CVR currently forecasts £0.00. Adopting later would require adjustment +£182,780.64 and would move the Final Forecast by +£182,780.64.',
  adjustmentSemantics:
    'The proposed replacement adjustment would replace the current CVR commercial adjustment; it is not added to it. This review does not write the CVR.',
  accrualNote: 'Accrual is shown for context only and is not changed by this review.',
  proposal: {
    assumptionPercent: 1.75,
    forecastRevenue: 10444608,
    forecastSellingCosts: 182780.64,
  },
  destination: {
    status: 'ready',
    costCodeKey: '5400',
    label: '5400 — Selling Costs — General Allowance',
  },
  comparison: {
    costCodeKey: '5400',
    costCodeDescription: '5400 — Selling Costs — General Allowance',
    systemForecast: 0,
    currentAdjustment: 0,
    currentFinalForecast: 0,
    proposedReplacementAdjustment: 182780.64,
    proposedFinalForecast: 182780.64,
    resultingMovement: 182780.64,
    currentAccrual: 0,
    coincidentalMatch: false,
    flags: { proposalBelowSystem: false, noCvrMember: false, coincidentalMatch: false },
  },
};

describe('DevelopmentSellingCostsCvrReview', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getSellingCostsCvrReview.mockResolvedValue(readyPreview);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function renderReview() {
    await act(async () => {
      root.render(<DevelopmentSellingCostsCvrReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();
  }

  it('shows Simple-mode comparison and no Adopt control', async () => {
    await renderReview();
    expect(getSellingCostsCvrReview).toHaveBeenCalledWith('dev-1');
    expect(document.querySelector('[data-testid="review-proposal-amount"]')?.textContent).toContain(
      '182,780.64'
    );
    expect(document.querySelector('[data-testid="review-system-forecast"]')?.textContent).toContain(
      '0.00'
    );
    expect(document.querySelector('[data-testid="review-proposed-adjustment"]')?.textContent).toContain(
      '182,780.64'
    );
    expect(document.querySelector('[data-testid="review-state"]')?.textContent).toMatch(/Not adopted/i);
    expect(document.querySelector('[data-testid="selling-costs-adopt"]')).toBeNull();
    expect(document.body.textContent).toMatch(/does not write anything/i);
    expect(document.body.textContent).not.toMatch(/\bAdopt\b/);
  });

  it('shows below-system warning without blocking the review', async () => {
    getSellingCostsCvrReview.mockResolvedValue({
      ...readyPreview,
      comparison: {
        ...readyPreview.comparison,
        systemForecast: 200000,
        currentFinalForecast: 200000,
        proposedReplacementAdjustment: -17219.36,
        resultingMovement: -17219.36,
        flags: { proposalBelowSystem: true, noCvrMember: false, coincidentalMatch: false },
      },
    });
    await renderReview();
    expect(document.querySelector('[data-testid="proposal-below-system"]')?.textContent).toMatch(
      /below system forecast/i
    );
  });

  it('shows blocked destination-not-on-CVR state without Add to CVR', async () => {
    getSellingCostsCvrReview.mockResolvedValue({
      ...readyPreview,
      reviewStatus: 'blocked',
      reviewState: 'blocked',
      comparison: null,
      headline: null,
      blockedReason: {
        code: 'destination_not_on_cvr',
        message: 'This Selling Costs destination is not currently a member of the open CVR.',
      },
    });
    await renderReview();
    expect(document.querySelector('[data-testid="selling-costs-review-blocked"]')).not.toBeNull();
    expect(document.body.textContent).toMatch(/not currently a member/i);
    expect(document.querySelector('[data-testid="add-to-cvr"]')).toBeNull();
    expect(document.querySelector('[data-testid="selling-costs-adopt"]')).toBeNull();
  });

  it('labels coincidental equality as not adopted', async () => {
    getSellingCostsCvrReview.mockResolvedValue({
      ...readyPreview,
      reviewState: 'not_adopted',
      comparison: {
        ...readyPreview.comparison,
        currentAdjustment: 182780.64,
        currentFinalForecast: 182780.64,
        resultingMovement: 0,
        coincidentalMatch: true,
        flags: { proposalBelowSystem: false, noCvrMember: false, coincidentalMatch: true },
      },
    });
    await renderReview();
    expect(document.querySelector('[data-testid="review-state"]')?.textContent).toMatch(
      /Not adopted — numbers coincide/i
    );
  });

  it('labels drifted provenance', async () => {
    getSellingCostsCvrReview.mockResolvedValue({
      ...readyPreview,
      reviewState: 'drifted',
    });
    await renderReview();
    expect(document.querySelector('[data-testid="review-state"]')?.textContent).toBe('Drifted');
  });

  it('labels superseded provenance', async () => {
    getSellingCostsCvrReview.mockResolvedValue({
      ...readyPreview,
      reviewState: 'superseded',
    });
    await renderReview();
    expect(document.querySelector('[data-testid="review-state"]')?.textContent).toBe('Superseded');
  });
});
