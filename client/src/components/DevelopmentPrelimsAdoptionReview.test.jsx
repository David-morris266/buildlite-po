/**
 * @vitest-environment jsdom
 * BL-033D.x.4B / x.4C.2 — Review against CVR + adoption confirmation UI
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const previewDevelopmentPrelimsAdoption = vi.hoisted(() => vi.fn());
const adoptDevelopmentPrelimsIntoCvr = vi.hoisted(() => vi.fn());
const addServerCvrCostCodeMember = vi.hoisted(() => vi.fn());
const PrelimsApiError = vi.hoisted(() => {
  return class DevelopmentPrelimsApiError extends Error {
    constructor(message, { status = 0, body = null } = {}) {
      super(message);
      this.name = 'DevelopmentPrelimsApiError';
      this.status = status;
      this.body = body;
    }
  };
});

vi.mock('../api/developmentPrelimsItems', () => ({
  previewDevelopmentPrelimsAdoption,
  adoptDevelopmentPrelimsIntoCvr,
  DevelopmentPrelimsApiError: PrelimsApiError,
}));

vi.mock('../cvr/cvrPeriodServerMutations', () => ({
  addServerCvrCostCodeMember,
}));

import DevelopmentPrelimsAdoptionReview from './DevelopmentPrelimsAdoptionReview';

function candidate5231(overrides = {}) {
  return {
    costCodeKey: '5231',
    costCodeDescription: 'Cleaning',
    resolvedPrelimsTotal: 58000,
    unresolvedCount: 1,
    systemForecast: 50280,
    currentAdjustment: 520,
    currentFinalForecast: 50800,
    proposedAdjustment: 7720,
    proposedFinalForecast: 58000,
    deltaFinal: 7200,
    manualAccrual: 120,
    proposalFingerprint: 'fp-5231',
    inputVersion: 1,
    inputId: 'input-5231',
    driftState: 'not_adopted',
    isUpToDate: false,
    cannotAdopt: false,
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
    ...overrides,
  };
}

function previewDoc(overrides = {}) {
  return {
    readOnly: true,
    developmentId: 'dev-1',
    periodKey: 'P04',
    periodId: 'period-p04',
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
    candidates: [candidate5231()],
    missingFromCvr: [
      {
        costCodeKey: 'UAT-CC-001',
        costCodeDescription: 'UAT-CC-001',
        resolvedPrelimsTotal: 1000,
        unresolvedCount: 0,
        missingFromCvrMessage:
          'This Prelims proposal uses a cost code that is not currently included as a CVR line.',
        flags: { noCvrRow: true, cannotAdopt: true },
        cannotAdopt: true,
        canAddToCvr: true,
        addBlockedReason: null,
        masterFound: true,
        masterActive: true,
      },
    ],
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DevelopmentPrelimsAdoptionReview (x.4C.2)', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    previewDevelopmentPrelimsAdoption.mockReset();
    adoptDevelopmentPrelimsIntoCvr.mockReset();
    addServerCvrCostCodeMember.mockReset();
    previewDevelopmentPrelimsAdoption.mockResolvedValue(previewDoc());
    addServerCvrCostCodeMember.mockResolvedValue({
      ok: true,
      input: {
        costCodeKey: 'UAT-CC-001',
        originalBudget: null,
        currentBudget: null,
        commercialAdjustment: 0,
        manualAccrual: 0,
        version: 1,
      },
    });
    adoptDevelopmentPrelimsIntoCvr.mockResolvedValue({
      periodKey: 'P04',
      adopted: [{ costCodeKey: '5231', newAdjustment: 7720 }],
      unchanged: [],
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders commercial review and keeps Adopt disabled until selection', async () => {
    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();

    expect(container.querySelector('[data-testid="review-intro-copy"]')?.textContent).toMatch(
      /does not change the CVR until you explicitly select/i
    );
    expect(container.querySelector('[data-testid="select-cost-code-5231"]')?.checked).toBe(false);
    expect(container.querySelector('[data-testid="adopt-selected"]')?.disabled).toBe(true);
    expect(container.querySelector('[data-testid="selected-count"]')?.textContent).toMatch(
      /0 selected/
    );
    expect(container.querySelector('[data-testid="prelims-review-missing-UAT-CC-001"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="select-cost-code-UAT-CC-001"]')).toBeNull();
    expect(container.querySelector('[data-testid="add-to-cvr-UAT-CC-001"]')).toBeTruthy();
    expect(addServerCvrCostCodeMember).not.toHaveBeenCalled();
    expect(adoptDevelopmentPrelimsIntoCvr).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="adoption-confirm-dialog"]')).toBeNull();
  });

  it('selects eligible code, opens confirmation with 5231 maths, and requires unresolved ack', async () => {
    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();

    await act(async () => {
      container.querySelector('[data-testid="select-cost-code-5231"]').click();
    });
    expect(container.querySelector('[data-testid="adopt-selected"]')?.disabled).toBe(false);

    await act(async () => {
      container.querySelector('[data-testid="adopt-selected"]').click();
    });

    const dialog = container.querySelector('[data-testid="adoption-confirm-dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toMatch(/Cleaning/);
    expect(dialog.textContent).toMatch(/58,000/);
    expect(dialog.textContent).toMatch(/50,280/);
    expect(dialog.textContent).toMatch(/\+£520|\+£520\.00/);
    expect(dialog.textContent).toMatch(/50,800/);
    expect(dialog.textContent).toMatch(/\+£7,720/);
    expect(dialog.textContent).toMatch(/\+£7,200/);
    expect(container.querySelector('[data-testid="confirm-replacement-wording"]')?.textContent).toMatch(
      /replaces the current CVR adjustment/i
    );
    expect(container.querySelector('[data-testid="confirm-unresolved-5231"]')?.textContent).toMatch(
      /excluded from this adoption/i
    );
    expect(container.querySelector('[data-testid="adoption-confirm"]')?.disabled).toBe(true);

    await act(async () => {
      container.querySelector('[data-testid="ack-unresolved"] input').click();
    });
    expect(container.querySelector('[data-testid="adoption-confirm"]')?.disabled).toBe(false);
  });

  it('Select all eligible is explicit and skips missing/up-to-date codes', async () => {
    previewDevelopmentPrelimsAdoption.mockResolvedValueOnce(
      previewDoc({
        candidates: [
          candidate5231({ unresolvedCount: 0, unresolvedLines: [], flags: { unresolvedExposure: false } }),
          candidate5231({
            costCodeKey: '5232',
            costCodeDescription: 'Other',
            proposalFingerprint: 'fp-5232',
            inputVersion: 1,
            unresolvedCount: 0,
            unresolvedLines: [],
            driftState: 'up_to_date',
            isUpToDate: true,
            flags: { unresolvedExposure: false, cannotAdopt: false, noCvrRow: false },
          }),
        ],
      })
    );
    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();

    expect(container.querySelector('[data-testid="select-cost-code-5232"]')).toBeNull();
    expect(container.querySelector('[data-testid="already-adopted-5232"]')).toBeTruthy();

    await act(async () => {
      container.querySelector('[data-testid="select-all-eligible"]').click();
    });
    expect(container.querySelector('[data-testid="select-cost-code-5231"]')?.checked).toBe(true);
    expect(container.querySelector('[data-testid="selected-count"]')?.textContent).toMatch(
      /1 selected/
    );
  });

  it('posts intent-only payload, shows success, clears selection, and refreshes preview', async () => {
    const refreshed = previewDoc({
      candidates: [
        candidate5231({
          currentAdjustment: 7720,
          currentFinalForecast: 58000,
          proposedAdjustment: 7720,
          deltaFinal: 0,
          driftState: 'up_to_date',
          isUpToDate: true,
          unresolvedCount: 0,
          unresolvedLines: [],
          inputVersion: 2,
          flags: { unresolvedExposure: false, cannotAdopt: false, noCvrRow: false },
        }),
      ],
    });
    previewDevelopmentPrelimsAdoption
      .mockResolvedValueOnce(previewDoc())
      .mockResolvedValueOnce(refreshed);

    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();

    await act(async () => {
      container.querySelector('[data-testid="select-cost-code-5231"]').click();
      container.querySelector('[data-testid="adopt-selected"]').click();
    });
    await act(async () => {
      container.querySelector('[data-testid="ack-unresolved"] input').click();
    });
    await act(async () => {
      container.querySelector('[data-testid="adoption-confirm"]').click();
    });
    await flush();

    expect(adoptDevelopmentPrelimsIntoCvr).toHaveBeenCalledTimes(1);
    const [devId, periodId, payload] = adoptDevelopmentPrelimsIntoCvr.mock.calls[0];
    expect(devId).toBe('dev-1');
    expect(periodId).toBe('period-p04');
    expect(payload.expectedPeriodKey).toBe('P04');
    expect(payload.expectedReportingMonth).toBe('2026-08');
    expect(payload.selections).toHaveLength(1);
    expect(payload.selections[0]).toEqual({
      costCodeKey: '5231',
      proposalFingerprint: 'fp-5231',
      expectedInputVersion: 1,
      expectedSystemForecast: 50280,
      expectedCurrentAdjustment: 520,
      acknowledgeUnresolvedExcluded: true,
      acknowledgeSupersededAdjustment: false,
    });
    expect(payload.selections[0].proposedAdjustment).toBeUndefined();
    expect(payload.proposedAdjustment).toBeUndefined();

    expect(container.querySelector('[data-testid="review-success"]')?.textContent).toMatch(
      /1 Prelims cost code adopted into P04/i
    );
    expect(container.querySelector('[data-testid="adoption-confirm-dialog"]')).toBeNull();
    expect(previewDevelopmentPrelimsAdoption).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="already-adopted-5231"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="select-cost-code-5231"]')).toBeNull();
    expect(container.querySelector('[data-testid="prelims-review-missing-UAT-CC-001"]')).toBeTruthy();
  });

  it('requires superseded acknowledgement when drift is adoption_superseded', async () => {
    previewDevelopmentPrelimsAdoption.mockResolvedValueOnce(
      previewDoc({
        candidates: [
          candidate5231({
            unresolvedCount: 0,
            unresolvedLines: [],
            driftState: 'adoption_superseded',
            adoptionMetadata: { adoptedAdjustment: 7720 },
            currentAdjustment: 9000,
            flags: { unresolvedExposure: false, cannotAdopt: false, noCvrRow: false },
          }),
        ],
      })
    );
    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();
    await act(async () => {
      container.querySelector('[data-testid="select-cost-code-5231"]').click();
      container.querySelector('[data-testid="adopt-selected"]').click();
    });
    expect(container.querySelector('[data-testid="confirm-superseded-5231"]')?.textContent).toMatch(
      /changed since the previous Prelims adoption/i
    );
    expect(container.querySelector('[data-testid="adoption-confirm"]')?.disabled).toBe(true);
    await act(async () => {
      container.querySelector('[data-testid="ack-superseded"] input').click();
    });
    expect(container.querySelector('[data-testid="adoption-confirm"]')?.disabled).toBe(false);
  });

  it('on 409 stale clears selection, refreshes, and does not retry', async () => {
    adoptDevelopmentPrelimsIntoCvr.mockRejectedValueOnce(
      new PrelimsApiError('stale', {
        status: 409,
        body: { code: 'PROPOSAL_STALE', message: 'stale' },
      })
    );
    previewDevelopmentPrelimsAdoption
      .mockResolvedValueOnce(previewDoc())
      .mockResolvedValueOnce(previewDoc());

    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();
    await act(async () => {
      container.querySelector('[data-testid="select-cost-code-5231"]').click();
      container.querySelector('[data-testid="adopt-selected"]').click();
    });
    await act(async () => {
      container.querySelector('[data-testid="ack-unresolved"] input').click();
      container.querySelector('[data-testid="adoption-confirm"]').click();
    });
    await flush();

    expect(adoptDevelopmentPrelimsIntoCvr).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="review-error"]')?.textContent).toMatch(
      /changed after this review/i
    );
    expect(container.querySelector('[data-testid="adoption-confirm-dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="select-cost-code-5231"]')?.checked).toBe(false);
    expect(previewDevelopmentPrelimsAdoption).toHaveBeenCalledTimes(2);
  });

  it('PERIOD_NOT_DRAFT disables adoption controls', async () => {
    previewDevelopmentPrelimsAdoption.mockResolvedValueOnce(
      previewDoc({ periodStatus: 'submitted' })
    );
    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();
    expect(container.querySelector('[data-testid="period-not-draft"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="adopt-selected"]')?.disabled).toBe(true);
    expect(container.querySelector('[data-testid="select-cost-code-5231"]')).toBeNull();
  });

  it('prevents double submit while adopting', async () => {
    let resolveAdopt;
    adoptDevelopmentPrelimsIntoCvr.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAdopt = resolve;
        })
    );
    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();
    await act(async () => {
      container.querySelector('[data-testid="select-cost-code-5231"]').click();
      container.querySelector('[data-testid="adopt-selected"]').click();
    });
    await act(async () => {
      container.querySelector('[data-testid="ack-unresolved"] input').click();
    });
    await act(async () => {
      container.querySelector('[data-testid="adoption-confirm"]').click();
    });
    expect(container.querySelector('[data-testid="adoption-confirm"]')?.textContent).toMatch(
      /Adopting/
    );
    expect(container.querySelector('[data-testid="adoption-confirm"]')?.disabled).toBe(true);
    await act(async () => {
      container.querySelector('[data-testid="adoption-confirm"]').click();
    });
    expect(adoptDevelopmentPrelimsIntoCvr).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveAdopt({ adopted: [{ costCodeKey: '5231' }], unchanged: [] });
    });
    await flush();
  });

  it('shows API failure visibly without assuming success', async () => {
    adoptDevelopmentPrelimsIntoCvr.mockRejectedValueOnce(
      new PrelimsApiError('Server exploded', { status: 500, body: { message: 'Server exploded' } })
    );
    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();
    await act(async () => {
      container.querySelector('[data-testid="select-cost-code-5231"]').click();
      container.querySelector('[data-testid="adopt-selected"]').click();
    });
    await act(async () => {
      container.querySelector('[data-testid="ack-unresolved"] input').click();
      container.querySelector('[data-testid="adoption-confirm"]').click();
    });
    await flush();
    expect(container.querySelector('[data-testid="adoption-confirm-error"]')?.textContent).toMatch(
      /Server exploded/
    );
    expect(container.querySelector('[data-testid="review-success"]')).toBeNull();
  });

  it('Back to Prelims still works', async () => {
    const onBack = vi.fn();
    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={onBack} />);
    });
    await flush();
    await act(async () => {
      container.querySelector('[data-testid="back-to-prelims"]').click();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Add to CVR calls the membership endpoint, does not adopt, and makes the code reviewable', async () => {
    const addedPreview = previewDoc({
      missingFromCvr: [],
      candidates: [
        candidate5231(),
        candidate5231({
          costCodeKey: 'UAT-CC-001',
          costCodeDescription: 'UAT-CC-001',
          resolvedPrelimsTotal: 1000,
          systemForecast: 0,
          currentAdjustment: 0,
          currentFinalForecast: 0,
          proposedAdjustment: 1000,
          proposedFinalForecast: 1000,
          deltaFinal: 1000,
          manualAccrual: 0,
          proposalFingerprint: 'fp-uat',
          inputVersion: 1,
          inputId: 'input-uat',
          unresolvedCount: 0,
          unresolvedLines: [],
          flags: { unresolvedExposure: false, noCvrRow: false, cannotAdopt: false },
        }),
      ],
    });
    previewDevelopmentPrelimsAdoption
      .mockResolvedValueOnce(previewDoc())
      .mockResolvedValueOnce(addedPreview);

    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();

    await act(async () => {
      container.querySelector('[data-testid="add-to-cvr-UAT-CC-001"]').click();
    });
    await flush();

    expect(addServerCvrCostCodeMember).toHaveBeenCalledTimes(1);
    expect(addServerCvrCostCodeMember).toHaveBeenCalledWith('dev-1', 'period-p04', {
      costCodeKey: 'UAT-CC-001',
    });
    expect(previewDevelopmentPrelimsAdoption).toHaveBeenCalledTimes(2);
    expect(adoptDevelopmentPrelimsIntoCvr).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="review-success"]')?.textContent).toMatch(
      /UAT-CC-001 added to P04/
    );
    expect(container.querySelector('[data-testid="prelims-review-missing-UAT-CC-001"]')).toBeNull();
    expect(container.querySelector('[data-testid="add-to-cvr-UAT-CC-001"]')).toBeNull();
    expect(container.querySelector('[data-testid="select-cost-code-UAT-CC-001"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="summary-not-on-cvr"]')?.textContent).not.toMatch(
      /1,000/
    );
  });

  it('does not offer Add when the CVR is no longer Draft', async () => {
    previewDevelopmentPrelimsAdoption.mockResolvedValueOnce(
      previewDoc({
        periodStatus: 'submitted',
        missingFromCvr: [
          {
            costCodeKey: 'UAT-CC-001',
            resolvedPrelimsTotal: 1000,
            unresolvedCount: 0,
            canAddToCvr: false,
            addBlockedReason: 'This CVR is no longer Draft, so a cost code cannot be added.',
            flags: { noCvrRow: true, cannotAdopt: true },
            cannotAdopt: true,
          },
        ],
      })
    );
    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();
    expect(container.querySelector('[data-testid="add-to-cvr-UAT-CC-001"]')).toBeNull();
    expect(container.querySelector('[data-testid="add-blocked-UAT-CC-001"]')?.textContent).toMatch(
      /no longer Draft/i
    );
  });

  it('does not offer Add for an inactive Master cost code', async () => {
    previewDevelopmentPrelimsAdoption.mockResolvedValueOnce(
      previewDoc({
        missingFromCvr: [
          {
            costCodeKey: 'UAT-CC-001',
            resolvedPrelimsTotal: 1000,
            unresolvedCount: 0,
            canAddToCvr: false,
            addBlockedReason: 'This cost code is inactive in Cost Code Master.',
            masterFound: true,
            masterActive: false,
            flags: { noCvrRow: true, cannotAdopt: true },
            cannotAdopt: true,
          },
        ],
      })
    );
    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();
    expect(container.querySelector('[data-testid="add-to-cvr-UAT-CC-001"]')).toBeNull();
    expect(container.querySelector('[data-testid="add-blocked-UAT-CC-001"]')?.textContent).toMatch(
      /inactive/i
    );
  });

  it('handles duplicate membership by refreshing rather than retrying', async () => {
    addServerCvrCostCodeMember.mockResolvedValueOnce({
      ok: false,
      code: 'COST_CODE_ALREADY_MEMBER',
      errors: ['A cost-code input already exists for this period.'],
      input: { costCodeKey: 'UAT-CC-001', originalBudget: null },
    });
    const alreadyOnCvr = previewDoc({
      missingFromCvr: [],
      candidates: [
        candidate5231(),
        candidate5231({
          costCodeKey: 'UAT-CC-001',
          unresolvedCount: 0,
          unresolvedLines: [],
          proposalFingerprint: 'fp-uat',
          inputVersion: 1,
          flags: { unresolvedExposure: false, noCvrRow: false, cannotAdopt: false },
        }),
      ],
    });
    previewDevelopmentPrelimsAdoption
      .mockResolvedValueOnce(previewDoc())
      .mockResolvedValueOnce(alreadyOnCvr);

    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();
    await act(async () => {
      container.querySelector('[data-testid="add-to-cvr-UAT-CC-001"]').click();
    });
    await flush();

    expect(addServerCvrCostCodeMember).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="review-success"]')?.textContent).toMatch(
      /already on P04/i
    );
    expect(container.querySelector('[data-testid="select-cost-code-UAT-CC-001"]')).toBeTruthy();
  });

  it('explains PERIOD_NOT_DRAFT and refreshes without retrying', async () => {
    addServerCvrCostCodeMember.mockResolvedValueOnce({
      ok: false,
      code: 'PERIOD_NOT_DRAFT',
      errors: ['Only draft CVR periods can be edited.'],
    });
    previewDevelopmentPrelimsAdoption
      .mockResolvedValueOnce(previewDoc())
      .mockResolvedValueOnce(previewDoc({ periodStatus: 'submitted' }));

    await act(async () => {
      root.render(<DevelopmentPrelimsAdoptionReview developmentId="dev-1" onBack={() => {}} />);
    });
    await flush();
    await act(async () => {
      container.querySelector('[data-testid="add-to-cvr-UAT-CC-001"]').click();
    });
    await flush();

    expect(addServerCvrCostCodeMember).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="review-error"]')?.textContent).toMatch(
      /no longer Draft/i
    );
    expect(container.querySelector('[data-testid="add-to-cvr-UAT-CC-001"]')).toBeNull();
  });
});
