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
const refreshCvrInputsForPeriod = vi.hoisted(() => vi.fn());
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

vi.mock('../cvr/cvrPeriodServerCache', () => ({
  refreshCvrInputsForPeriod,
}));

const readyPreview = {
  readOnly: true,
  canAdopt: true,
  reviewStatus: 'ready',
  reviewState: 'not_adopted',
  periodKey: 'P04',
  periodVersion: 1,
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
    refreshCvrInputsForPeriod.mockReset();
    refreshCvrInputsForPeriod.mockResolvedValue([]);
    getSellingCostsCvrReview.mockResolvedValue(readyPreview);
    adoptSellingCostsIntoCvr.mockResolvedValue({
      periodId: 'period-result',
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

  it('builds a period-versioned multi-destination Detailed adoption intent from reviewed comparisons', () => {
    const preview = {
      ...readyPreview,
      periodVersion: 4,
      proposal: { ...readyPreview.proposal, mode: 'detailed', settings: { version: 12 } },
      comparisons: [
        { ...readyPreview.comparison, costCodeKey: '6110', proposalFingerprint: 'detail-6110', inputVersion: 2 },
        { ...readyPreview.comparison, costCodeKey: '6170', proposalFingerprint: 'detail-6170', inputVersion: 3 },
      ],
    };
    const payload = buildAdoptionIntentPayload(preview);
    expect(payload.expectedPeriodVersion).toBe(4);
    expect(payload.expectedSettingsVersion).toBe(12);
    expect(payload.selections.map(item => [item.destinationCostCodeKey,item.proposalFingerprint,item.expectedInputVersion])).toEqual([
      ['6110','detail-6110',2],['6170','detail-6170',3],
    ]);
  });

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

  it('shows the complete destination reconciliation and sends reviewed row expectations', async () => {
    const preview = {
      ...readyPreview,
      reconciliation: [
        { action: 'released', costCodeKey: '6170', costCodeDescription: 'Sales Office Set-up', inputVersion: 2, currentAdjustment: 115062.5, proposedAdjustment: 0 },
        { action: 'added', costCodeKey: '6210', costCodeDescription: 'Sales Office Cleaning', inputVersion: 1, currentAdjustment: 0, proposedAdjustment: 98625 },
        { action: 'preserved_manual', costCodeKey: '6220', costCodeDescription: 'Manual sales risk', inputVersion: 4, currentAdjustment: 5000, proposedAdjustment: 5000 },
      ],
    };
    getSellingCostsCvrReview.mockResolvedValue(preview);
    await renderReview();
    const review = document.querySelector('[data-testid="review-reconciliation"]');
    expect(review.textContent).toMatch(/Release/);
    expect(review.textContent).toMatch(/Adopt/);
    expect(review.textContent).toMatch(/Preserve manual position/);
    expect(review.textContent).toMatch(/will not be changed automatically/);
    const payload = buildAdoptionIntentPayload(preview);
    expect(payload.reconciliationExpectations).toEqual([
      { costCodeKey: '6170', expectedInputVersion: 2, expectedCurrentAdjustment: 115062.5, action: 'released' },
      { costCodeKey: '6210', expectedInputVersion: 1, expectedCurrentAdjustment: 0, action: 'added' },
      { costCodeKey: '6220', expectedInputVersion: 4, expectedCurrentAdjustment: 5000, action: 'preserved_manual' },
    ]);
  });

  it('presents one Hawthorn-shaped Detailed transaction table before the Adopt action', async () => {
    const destinations = [
      ['6110', 'Sales Legal Fees', 10000],
      ['6120', 'Estate Agents', 125122.5],
      ['6150', 'Signs & Flags', 2500],
      ['6170', 'Sales Office Set-up', 35000],
      ['6180', 'Marketing', 10000],
      ['6190', 'Show Homes', 20000],
      ['6200', 'Launch Costs', 15000],
      ['6220', 'Customer Events', 20000],
      ['6230', 'Other Selling Costs', 15250],
    ];
    const comparisons = destinations.map(([costCodeKey, description, amount]) => ({
      ...readyPreview.comparison,
      costCodeKey,
      costCodeDescription: `${costCodeKey} â€” ${description}`,
      systemForecast: 0,
      currentFinalForecast: 0,
      proposedReplacementAdjustment: amount,
      proposedFinalForecast: amount,
      resultingMovement: amount,
      proposalFingerprint: `detail-${costCodeKey}`,
      inputVersion: 1,
      constituentLines: costCodeKey === '6170' ? [
        { id: 'line-a', name: 'Show Home Furnishing', driver: 'QUANTITY_RATE', resolvedQuantity: 20, quantitySource: 'PRIVATE_SALE_PLOTS', rate: 1000, forecast: 20000 },
        { id: 'line-b', name: 'Sales Office / Marketing Suite Setup', driver: 'LUMP_SUM', lumpSum: 15000, forecast: 15000 },
      ] : [{ id: `line-${costCodeKey}`, name: description, driver: 'LUMP_SUM', lumpSum: amount, forecast: amount }],
    }));
    const reconciliation = [
      ...comparisons.map((comparison) => ({
        action: 'added',
        costCodeKey: comparison.costCodeKey,
        costCodeDescription: comparison.costCodeDescription,
        inputVersion: comparison.inputVersion,
        currentAdjustment: comparison.currentAdjustment,
        proposedAdjustment: comparison.proposedReplacementAdjustment,
        resultingMovement: comparison.resultingMovement,
        constituentLines: comparison.constituentLines,
      })),
      { action: 'released', costCodeKey: '6210', costCodeDescription: '6210 â€” Sales Running Costs', inputVersion: 2, currentAdjustment: 98625, proposedAdjustment: 0, resultingMovement: -98625 },
    ];
    getSellingCostsCvrReview.mockResolvedValue({
      ...readyPreview,
      proposal: { ...readyPreview.proposal, mode: 'detailed', forecastSellingCosts: 252872.5, assumptionPercent: null },
      comparisons,
      comparison: comparisons[0],
      reconciliation,
    });

    await renderReview();

    const summary = document.querySelector('[data-testid="detailed-transaction-summary"]');
    expect(summary.textContent).toMatch(/Detailed Selling Costs proposal.*252,872\.50/);
    expect(summary.textContent).toMatch(/Previous Selling Costs to release.*98,625\.00/);
    expect(document.querySelector('[data-testid="review-net-movement"]').textContent).toContain('154,247.50');
    expect(document.querySelector('[data-testid="review-transaction-counts"]').textContent).toMatch(/9 destinations adopted.*1 released/);
    expect(reconciliation.reduce((sum, row) => sum + row.resultingMovement, 0)).toBe(154247.5);

    const tables = document.querySelectorAll('[data-testid="review-reconciliation"]');
    expect(tables).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="selling-costs-review-card"]')).toHaveLength(0);
    expect(tables[0].textContent).toMatch(/6170 — Sales Office Set-up/);
    expect(tables[0].textContent).not.toMatch(/6170\s*[â€”Â·-]\s*6170/);
    const release = tables[0].querySelector('[data-action="released"]');
    expect(release.textContent).toMatch(/6210 — Sales Running Costs.*98,625\.00.*0\.00.*98,625\.00.*Release/);
    expect(release.className).toMatch(/--release/);

    const row6170 = tables[0].querySelector('[data-action="added"]:has(.dev-selling-costs-review-row__identity strong)');
    const detailedDisclosure = [...tables[0].querySelectorAll('details')].find((node) => node.textContent.includes('Show Home Furnishing'));
    expect(detailedDisclosure.textContent).toMatch(/From 2 Detailed lines/);
    expect(detailedDisclosure.textContent).toMatch(/Show Home Furnishing.*20 private-sale plots.*1,000\.00.*20,000\.00/);
    expect(detailedDisclosure.textContent).toMatch(/Sales Office \/ Marketing Suite Setup.*Lump sum.*15,000\.00/);
    expect(row6170).not.toBeNull();
    const adopt = document.querySelector('[data-testid="selling-costs-adopt"]');
    expect(tables[0].compareDocumentPosition(adopt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll('[data-testid="selling-costs-adopt"]')).toHaveLength(1);
  });

  it('keeps non-zero System Forecast context accessible in the compact Detailed row', async () => {
    const comparison = {
      ...readyPreview.comparison,
      costCodeKey: '6110',
      costCodeDescription: '6110 â€” Sales Legal Fees',
      systemForecast: 2500,
      currentFinalForecast: 2500,
      proposedReplacementAdjustment: 7500,
      proposedFinalForecast: 10000,
      resultingMovement: 7500,
    };
    getSellingCostsCvrReview.mockResolvedValue({
      ...readyPreview,
      proposal: { ...readyPreview.proposal, mode: 'detailed', forecastSellingCosts: 10000 },
      comparison,
      comparisons: [comparison],
      reconciliation: [{ action: 'added', costCodeKey: '6110', costCodeDescription: comparison.costCodeDescription, inputVersion: 1, currentAdjustment: 0, proposedAdjustment: 7500, resultingMovement: 7500 }],
    });
    await renderReview();
    const context = [...document.querySelectorAll('details')].find((node) => node.textContent.includes('CVR calculation context'));
    expect(context.textContent).toMatch(/System Forecast.*2,500\.00/);
    expect(context.textContent).toMatch(/Proposed replacement adjustment.*7,500\.00/);
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
      /Selling Costs were adopted into P04/i
    );
    expect(getSellingCostsCvrReview.mock.calls.length).toBeGreaterThan(1);
    expect(refreshCvrInputsForPeriod).toHaveBeenCalledWith('dev-1', 'period-result');
  });

  it('uses the reviewed period as the controlled refresh fallback', async () => {
    adoptSellingCostsIntoCvr.mockResolvedValueOnce({
      periodKey: 'P04',
      adopted: [{ costCodeKey: '5400', result: 'adopted' }],
      unchanged: [],
    });
    await renderReview();
    await act(async () => document.querySelector('[data-testid="selling-costs-adopt"]').click());
    await act(async () => document.querySelector('[data-testid="confirm-adoption"]').click());
    await flush();
    expect(refreshCvrInputsForPeriod).toHaveBeenCalledWith('dev-1', 'period-1');
  });

  it('keeps a committed adoption successful when the authoritative CVR refresh fails', async () => {
    refreshCvrInputsForPeriod.mockRejectedValueOnce(new Error('inputs unavailable'));
    await renderReview();
    await act(async () => document.querySelector('[data-testid="selling-costs-adopt"]').click());
    await act(async () => document.querySelector('[data-testid="confirm-adoption"]').click());
    await flush();

    expect(document.querySelector('[data-testid="selling-costs-adoption-confirm"]')).toBeNull();
    expect(document.querySelector('[data-testid="selling-costs-adopt-success"]')?.textContent).toMatch(
      /Selling Costs were adopted into P04.*could not refresh the CVR display.*Reload the CVR/i
    );
    expect(document.querySelector('[data-testid="selling-costs-review-error"]')).toBeNull();
    expect(adoptSellingCostsIntoCvr).toHaveBeenCalledTimes(1);
    expect(getSellingCostsCvrReview.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not refresh CVR inputs when confirmation is cancelled', async () => {
    await renderReview();
    await act(async () => document.querySelector('[data-testid="selling-costs-adopt"]').click());
    await act(async () => document.querySelector('[data-testid="cancel-adoption"]').click());
    expect(refreshCvrInputsForPeriod).not.toHaveBeenCalled();
    expect(adoptSellingCostsIntoCvr).not.toHaveBeenCalled();
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
    expect(refreshCvrInputsForPeriod).not.toHaveBeenCalled();
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
    expect(refreshCvrInputsForPeriod).not.toHaveBeenCalled();
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
    expect(refreshCvrInputsForPeriod).not.toHaveBeenCalled();
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
    expect(refreshCvrInputsForPeriod).not.toHaveBeenCalled();
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
