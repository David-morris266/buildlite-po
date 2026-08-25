/**
 * @vitest-environment jsdom
 * BL-034C/D — Selling Costs Review against CVR + Adopt confirmation
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import DevelopmentSellingCostsCvrReview, {
  buildAdoptionIntentPayload,
} from './DevelopmentSellingCostsCvrReview';

const getSellingCostsCvrReview = vi.hoisted(() => vi.fn());
const adoptSellingCostsIntoCvr = vi.hoisted(() => vi.fn());
const SellingCostsApiError = vi.hoisted(() => {
  return class SellingCostsApiError extends Error {
    constructor(message, { status = 0, body = null } = {}) {
      super(message);
      this.name = 'SellingCostsApiError';
      this.status = status;
      this.body = body;
    }
  };
});

vi.mock('../api/sellingCosts', () => ({
  SellingCostsApiError,
  getSellingCostsCvrReview,
  adoptSellingCostsIntoCvr,
}));

const readyPreview = {
  readOnly: true,
  canAdopt: true,
  reviewStatus: 'ready',
  reviewState: 'not_adopted',
  periodKey: 'P04',
  periodId: 'period-1',
  periodStatus: 'draft',
  reportingMonth: '2026-08',
  blockedReason: null,
  headline:
    'BuildLite currently proposes £182,780.64 of Selling Costs. The CVR currently forecasts £0.00. Adopting would require replacement adjustment +£182,780.64 and would move the Final Forecast by +£182,780.64.',
  adjustmentSemantics:
    'The proposed replacement adjustment would replace the current CVR commercial adjustment; it is not added to it. This review does not write the CVR.',
  accrualNote: 'Accrual is shown for context only and is not changed by this review.',
  proposal: {
    assumptionPercent: 1.75,
    forecastRevenue: 10444608,
    forecastSellingCosts: 182780.64,
    settings: { exists: true, version: 1, destinationCostCodeKey: null },
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
    proposalFingerprint: 'bl034c-fingerprint',
    inputVersion: 1,
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
    getSellingCostsCvrReview.mockReset();
    adoptSellingCostsIntoCvr.mockReset();
    getSellingCostsCvrReview.mockResolvedValue(readyPreview);
    adoptSellingCostsIntoCvr.mockResolvedValue({
      periodKey: 'P04',
      adopted: [{ costCodeKey: '5400', result: 'adopted' }],
      unchanged: [],
    });
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

  it('shows Simple-mode comparison as read-only until Adopt is chosen', async () => {
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
    expect(document.querySelector('[data-testid="selling-costs-adopt"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="selling-costs-adoption-confirm"]')).toBeNull();
    expect(adoptSellingCostsIntoCvr).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/Original Budget|write budget/i);
    expect(document.querySelector('[data-testid="review-accrual"]')?.textContent).toContain('0.00');
  });

  it('opens confirmation before POST and sends intent-only payload', async () => {
    await renderReview();
    await act(async () => {
      document.querySelector('[data-testid="selling-costs-adopt"]').click();
    });
    expect(document.querySelector('[data-testid="selling-costs-adoption-confirm"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="confirm-replacement-wording"]')?.textContent).toMatch(
      /replaces the current CVR adjustment; it is not added to it/i
    );
    expect(document.querySelector('[data-testid="confirm-no-budget-system-accrual"]')?.textContent).toMatch(
      /does not change budget, system forecast or accrual/i
    );
    expect(adoptSellingCostsIntoCvr).not.toHaveBeenCalled();

    await act(async () => {
      document.querySelector('[data-testid="confirm-adoption"]').click();
    });
    await flush();

    expect(adoptSellingCostsIntoCvr).toHaveBeenCalledTimes(1);
    const [devId, payload] = adoptSellingCostsIntoCvr.mock.calls[0];
    expect(devId).toBe('dev-1');
    expect(payload).toEqual(
      buildAdoptionIntentPayload(readyPreview, {
        acknowledgeSuperseded: false,
        acknowledgeBelowSystem: false,
      })
    );
    expect(payload.selections[0].proposedAdjustment).toBeUndefined();
    expect(payload.selections[0].proposedFinal).toBeUndefined();
    expect(payload.forecastRevenue).toBeUndefined();
    expect(payload.assumptionPercent).toBeUndefined();
    expect(document.querySelector('[data-testid="selling-costs-adopt-success"]')?.textContent).toMatch(
      /Selling Costs adopted into P04/i
    );
    expect(getSellingCostsCvrReview.mock.calls.length).toBeGreaterThan(1);
  });

  it('shows Up to date after successful adoption refresh', async () => {
    getSellingCostsCvrReview
      .mockResolvedValueOnce(readyPreview)
      .mockResolvedValueOnce({
        ...readyPreview,
        reviewState: 'up_to_date',
        headline: 'Selling Costs is up to date on the current CVR.',
        comparison: {
          ...readyPreview.comparison,
          currentAdjustment: 182780.64,
          currentFinalForecast: 182780.64,
          proposedReplacementAdjustment: 182780.64,
          resultingMovement: 0,
        },
      });
    await renderReview();
    await act(async () => {
      document.querySelector('[data-testid="selling-costs-adopt"]').click();
    });
    await act(async () => {
      document.querySelector('[data-testid="confirm-adoption"]').click();
    });
    await flush();
    expect(document.querySelector('[data-testid="review-state"]')?.textContent).toBe('Up to date');
  });

  it('does not double-submit while adopting', async () => {
    let resolveAdopt;
    adoptSellingCostsIntoCvr.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAdopt = resolve;
        })
    );
    await renderReview();
    await act(async () => {
      document.querySelector('[data-testid="selling-costs-adopt"]').click();
    });
    await act(async () => {
      document.querySelector('[data-testid="confirm-adoption"]').click();
    });
    expect(document.querySelector('[data-testid="confirm-adoption"]')?.disabled).toBe(true);
    await act(async () => {
      document.querySelector('[data-testid="confirm-adoption"]').click();
    });
    expect(adoptSellingCostsIntoCvr).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveAdopt({ periodKey: 'P04', adopted: [{ costCodeKey: '5400' }], unchanged: [] });
    });
    await flush();
  });

  it('requires below-system acknowledgement before confirm', async () => {
    getSellingCostsCvrReview.mockResolvedValue({
      ...readyPreview,
      comparison: {
        ...readyPreview.comparison,
        systemForecast: 200000,
        currentFinalForecast: 200000,
        proposedReplacementAdjustment: -17219.36,
        proposedFinalForecast: 182780.64,
        resultingMovement: -17219.36,
        flags: { proposalBelowSystem: true, noCvrMember: false, coincidentalMatch: false },
      },
    });
    await renderReview();
    expect(document.querySelector('[data-testid="proposal-below-system"]')).not.toBeNull();
    await act(async () => {
      document.querySelector('[data-testid="selling-costs-adopt"]').click();
    });
    expect(document.querySelector('[data-testid="confirm-below-system"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="confirm-adoption"]')?.disabled).toBe(true);
    expect(adoptSellingCostsIntoCvr).not.toHaveBeenCalled();
    await act(async () => {
      document.querySelector('[data-testid="ack-below-system"] input').click();
    });
    expect(document.querySelector('[data-testid="confirm-adoption"]')?.disabled).toBe(false);
    await act(async () => {
      document.querySelector('[data-testid="confirm-adoption"]').click();
    });
    await flush();
    expect(adoptSellingCostsIntoCvr.mock.calls[0][1].selections[0].acknowledgeProposalBelowSystem).toBe(
      true
    );
  });

  it('requires superseded acknowledgement before confirm', async () => {
    getSellingCostsCvrReview.mockResolvedValue({
      ...readyPreview,
      reviewState: 'superseded',
      comparison: {
        ...readyPreview.comparison,
        currentAdjustment: 50,
        currentFinalForecast: 50,
        resultingMovement: 182730.64,
        adoptionMetadata: { adoptedAdjustment: 182780.64 },
      },
    });
    await renderReview();
    await act(async () => {
      document.querySelector('[data-testid="selling-costs-adopt"]').click();
    });
    expect(document.querySelector('[data-testid="confirm-superseded"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="confirm-adoption"]')?.disabled).toBe(true);
    await act(async () => {
      document.querySelector('[data-testid="ack-superseded"] input').click();
    });
    await act(async () => {
      document.querySelector('[data-testid="confirm-adoption"]').click();
    });
    await flush();
    expect(adoptSellingCostsIntoCvr.mock.calls[0][1].selections[0].acknowledgeSupersededAdjustment).toBe(
      true
    );
  });

  it('refreshes on stale 409 without retrying', async () => {
    adoptSellingCostsIntoCvr.mockRejectedValueOnce(
      new SellingCostsApiError('proposal stale', {
        status: 409,
        body: { code: 'SELLING_COSTS_PROPOSAL_STALE', message: 'proposal stale' },
      })
    );
    getSellingCostsCvrReview
      .mockResolvedValueOnce(readyPreview)
      .mockResolvedValueOnce({
        ...readyPreview,
        comparison: { ...readyPreview.comparison, proposalFingerprint: 'bl034c-new' },
      });
    await renderReview();
    await act(async () => {
      document.querySelector('[data-testid="selling-costs-adopt"]').click();
    });
    await act(async () => {
      document.querySelector('[data-testid="confirm-adoption"]').click();
    });
    await flush();
    expect(adoptSellingCostsIntoCvr).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="selling-costs-adoption-confirm"]')).toBeNull();
    expect(document.querySelector('[data-testid="selling-costs-review-error"]')?.textContent).toMatch(
      /Forecast Revenue or the Selling Costs proposal changed/i
    );
  });

  it('handles PERIOD_NOT_DRAFT without retrying', async () => {
    adoptSellingCostsIntoCvr.mockRejectedValueOnce(
      new SellingCostsApiError('not draft', {
        status: 409,
        body: { code: 'PERIOD_NOT_DRAFT', message: 'not draft' },
      })
    );
    getSellingCostsCvrReview
      .mockResolvedValueOnce(readyPreview)
      .mockResolvedValueOnce({ ...readyPreview, canAdopt: false, periodStatus: 'submitted' });
    await renderReview();
    await act(async () => {
      document.querySelector('[data-testid="selling-costs-adopt"]').click();
    });
    await act(async () => {
      document.querySelector('[data-testid="confirm-adoption"]').click();
    });
    await flush();
    expect(adoptSellingCostsIntoCvr).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="selling-costs-review-error"]')?.textContent).toMatch(
      /no longer Draft/i
    );
    expect(document.querySelector('[data-testid="selling-costs-adopt"]')).toBeNull();
  });

  it('shows API failure without posting again', async () => {
    adoptSellingCostsIntoCvr.mockRejectedValueOnce(
      new SellingCostsApiError('server exploded', { status: 500, body: { message: 'server exploded' } })
    );
    await renderReview();
    await act(async () => {
      document.querySelector('[data-testid="selling-costs-adopt"]').click();
    });
    await act(async () => {
      document.querySelector('[data-testid="confirm-adoption"]').click();
    });
    await flush();
    expect(adoptSellingCostsIntoCvr).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="selling-costs-review-error"]')?.textContent).toMatch(
      /server exploded/i
    );
  });

  it('hides Adopt when destination is missing from CVR', async () => {
    getSellingCostsCvrReview.mockResolvedValue({
      ...readyPreview,
      canAdopt: false,
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

  it('shows accrual context only and no budget/system write controls', async () => {
    await renderReview();
    expect(document.querySelector('[data-testid="review-accrual"]')).not.toBeNull();
    expect(document.body.textContent).toMatch(/context only/i);
    expect(document.querySelector('input[name="originalBudget"]')).toBeNull();
    expect(document.querySelector('input[name="systemForecast"]')).toBeNull();
    expect(document.querySelector('input[name="manualAccrual"]')).toBeNull();
  });
});
