/**
 * BL-034C/D — Selling Costs Review against CVR + deliberate Adopt.
 * Comparison remains read-only. Adoption is a separate confirmation POST.
 */

/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useState } from 'react';
import { formatCvrMoney } from '../cvr/cvrHelpers';
import {
  adoptSellingCostsIntoCvr,
  getSellingCostsCvrReview,
  SellingCostsApiError,
} from '../api/sellingCosts';
import { refreshCvrInputsForPeriod } from '../cvr/cvrPeriodServerCache';

function money(value) {
  if (value == null) return '—';
  return formatCvrMoney(value);
}

function signedMoney(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n > 0) return `+${formatCvrMoney(n)}`;
  if (n < 0) return `−${formatCvrMoney(Math.abs(n))}`;
  return formatCvrMoney(0);
}

function formatPercent(value) {
  if (value == null || value === '') return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `${(Math.round((amount + Number.EPSILON) * 100) / 100).toFixed(2)}%`;
}

function isPeriodDraft(preview) {
  return String(preview?.periodStatus || '').toLowerCase() === 'draft';
}

function stateLabel(preview) {
  const state = preview?.reviewState;
  if (preview?.reviewStatus === 'blocked') {
    if (preview.blockedReason?.code === 'destination_not_on_cvr') {
      return 'Not on current CVR';
    }
    return 'Review blocked';
  }
  switch (state) {
    case 'up_to_date':
      return 'Up to date';
    case 'drifted':
      return 'Drifted';
    case 'superseded':
      return 'Superseded';
    case 'not_adopted':
      return preview?.comparison?.coincidentalMatch
        ? 'Not adopted — numbers coincide'
        : 'Not adopted';
    default:
      return 'Not adopted';
  }
}

function canAdoptFromPreview(preview) {
  return Boolean(
    preview?.canAdopt &&
      preview.reviewStatus === 'ready' &&
      preview.comparison &&
      isPeriodDraft(preview)
  );
}

function reconciliationLabel(action) {
  switch (action) {
    case 'released': return 'Release';
    case 'preserved_manual': return 'Preserve manual position';
    case 'retained': return 'Update';
    case 'replace_manual': return 'Acknowledgement required';
    case 'unchanged': return 'Unchanged';
    default: return 'Adopt';
  }
}

function costCodeDescription(row) {
  const code = String(row?.costCodeKey || '').trim();
  const description = String(row?.costCodeDescription || '').trim();
  if (!description || description === code) return '';
  return description
    .replace(code, '')
    .replace(/^\s*(?:\u2014|\u00b7|-|\u00e2\u20ac\u201d|\u00c2\u00b7)\s*/, '')
    .trim();
}

function lineBasis(line) {
  if (line?.driver === 'QUANTITY_RATE') {
    const quantity = line.resolvedQuantity ?? line.quantity;
    const source = line.quantitySource === 'PRIVATE_SALE_PLOTS'
      ? 'private-sale plots'
      : line.quantitySource === 'TOTAL_PLOTS'
        ? 'plots'
        : line.unitCode?.toLowerCase();
    return quantity != null && line.rate != null
      ? `${quantity} ${source || 'units'} \u00d7 ${money(line.rate)}`
      : 'Quantity \u00d7 rate';
  }
  if (line?.driver === 'PERCENT_REVENUE') return `${formatPercent(line.percent)} of Forecast Revenue`;
  if (line?.driver === 'LUMP_SUM') return 'Lump sum';
  return '';
}

export function buildReviewTransactionSummary(rows = [], proposalAmount = null) {
  const reviewedRows = Array.isArray(rows) ? rows : [];
  const movement = (row) => Number(
    row.resultingMovement ??
      (Number(row.proposedAdjustment || 0) - Number(row.currentAdjustment || 0))
  );
  const released = reviewedRows.filter((row) => row.action === 'released');
  return {
    proposalAmount,
    releaseAmount: released.reduce((total, row) => total + Math.abs(movement(row)), 0),
    netMovement: reviewedRows.reduce((total, row) => total + movement(row), 0),
    destinationCount: reviewedRows.filter(
      (row) => !['released', 'preserved_manual'].includes(row.action)
    ).length,
    releaseCount: released.length,
  };
}

function ReconciliationRows({ rows, comparisons = [], prefix = 'review' }) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return (
    <div className="dev-selling-costs-review-table" data-testid={`${prefix}-reconciliation`}>
      <div className="dev-selling-costs-review-table__head" aria-hidden="true">
        <span>Cost Code</span><span>Current</span><span>Proposed</span><span>Movement</span><span>Action</span>
      </div>
      {rows.map((row) => {
        const comparison = comparisons.find((item) => item.costCodeKey === row.costCodeKey);
        const current = comparison?.currentFinalForecast ?? row.currentAdjustment;
        const proposed = comparison?.proposedFinalForecast ?? row.proposedAdjustment;
        const rowMovement = Number(
          row.resultingMovement ??
            (Number(row.proposedAdjustment || 0) - Number(row.currentAdjustment || 0))
        );
        const description = costCodeDescription(row);
        const release = row.action === 'released';
        return (
          <article className={`dev-selling-costs-review-row${release ? ' dev-selling-costs-review-row--release' : ''}`} key={`${row.action}-${row.costCodeKey}`} data-action={row.action}>
            <div className="dev-selling-costs-review-row__identity"><strong>{row.costCodeKey}</strong>{description ? <span aria-hidden="true"> &mdash; </span> : null}{description ? <span>{description}</span> : null}</div>
            <div data-label="Current">{money(current)}</div>
            <div data-label="Proposed">{money(proposed)}</div>
            <div data-label="Movement" className={rowMovement > 0 ? 'dev-prelims-review__delta--up' : rowMovement < 0 ? 'dev-prelims-review__delta--down' : undefined}>{signedMoney(rowMovement)}</div>
            <div data-label="Action"><span className={`dev-selling-costs-review-row__action dev-selling-costs-review-row__action--${row.action}`}>{reconciliationLabel(row.action)}</span></div>
            {release ? <p className="dev-selling-costs-review-row__note">Releases the earlier Selling Costs-owned position. The Cost Code and System Forecast remain unchanged.</p> : null}
            {row.action === 'preserved_manual' ? <p className="dev-selling-costs-review-row__note">This position is now manual and will not be changed automatically.</p> : null}
            {Array.isArray(row.constituentLines) && row.constituentLines.length ? (
              <details className="dev-selling-costs-review-row__evidence"><summary>From {row.constituentLines.length} Detailed line{row.constituentLines.length === 1 ? '' : 's'}</summary><ul>{row.constituentLines.map(line => <li key={line.id}><span><strong>{line.name}</strong>{lineBasis(line) ? <small>{lineBasis(line)}</small> : null}</span><strong>{money(line.forecast)}</strong></li>)}</ul></details>
            ) : null}
            {comparison && (Number(comparison.systemForecast) !== 0 || Number(comparison.currentAccrual) !== 0) ? (
              <details className="dev-selling-costs-review-row__evidence"><summary>CVR calculation context</summary><dl><div><dt>System Forecast</dt><dd>{money(comparison.systemForecast)}</dd></div><div><dt>Current adjustment</dt><dd>{signedMoney(comparison.currentAdjustment)}</dd></div><div><dt>Proposed replacement adjustment</dt><dd>{signedMoney(comparison.proposedReplacementAdjustment)}</dd></div><div><dt>Accrual (unchanged)</dt><dd>{money(comparison.currentAccrual)}</dd></div></dl></details>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function buildAdoptionIntentPayload(preview, { acknowledgeSuperseded, acknowledgeBelowSystem } = {}) {
  const comparisons = Array.isArray(preview?.comparisons) && preview.comparisons.length ? preview.comparisons : [preview?.comparison || {}];
  return {
    expectedPeriodKey: preview.periodKey,
    expectedPeriodVersion: preview.periodVersion,
    expectedReportingMonth: preview.reportingMonth,
    expectedSettingsVersion: Number(preview.proposal?.settings?.version) || 0,
    selections: comparisons.map(comparison => ({
        destinationCostCodeKey: comparison.costCodeKey || preview.destination?.costCodeKey,
        proposalFingerprint: comparison.proposalFingerprint,
        expectedInputVersion: comparison.inputVersion,
        expectedSystemForecast: comparison.systemForecast,
        expectedCurrentAdjustment: comparison.currentAdjustment,
        acknowledgeSupersededAdjustment: Boolean(acknowledgeSuperseded),
        acknowledgeProposalBelowSystem: Boolean(acknowledgeBelowSystem),
      })),
    reconciliationExpectations: (preview?.reconciliation || []).map((row) => ({
      costCodeKey: row.costCodeKey,
      expectedInputVersion: row.inputVersion,
      expectedCurrentAdjustment: row.currentAdjustment,
      action: row.action,
    })),
  };
}

export function sellingCostsAdoptionConflictMessage(err) {
  const code = err?.body?.code;
  switch (code) {
    case 'PERIOD_NOT_DRAFT':
      return 'Adoption is unavailable because the open CVR period is no longer Draft.';
    case 'PERIOD_KEY_CHANGED':
      return 'The open CVR period has changed since this review. Refresh and review again.';
    case 'PERIOD_VERSION_CHANGED':
      return 'The CVR period changed since this review. Refresh and review again.';
    case 'REPORTING_MONTH_CHANGED':
      return 'The CVR reporting month has changed since this review. Refresh and review again.';
    case 'SELLING_COSTS_SETTINGS_CHANGED':
      return 'Selling Costs assumption changed. Refresh and review again before adopting.';
    case 'SELLING_COSTS_PROPOSAL_STALE':
      return 'Forecast Revenue or the Selling Costs proposal changed. Refresh and review again before adopting.';
    case 'SYSTEM_FORECAST_DRIFT':
      return 'CVR system forecast changed. Refresh and review again before adopting.';
    case 'CURRENT_ADJUSTMENT_DRIFT':
      return 'CVR adjustment changed. Refresh and review again before adopting.';
    case 'CVR_INPUT_CONFLICT':
      return 'This CVR line changed since review. Refresh and review again before adopting.';
    case 'DESTINATION_NOT_ON_CVR':
      return 'This Selling Costs destination is not on the current CVR. Add it to the CVR first.';
    case 'DESTINATION_INVALID':
      return 'The Selling Costs destination is no longer valid. Refresh and review again.';
    case 'SUPERSEDED_ACK_REQUIRED':
      return 'The current CVR adjustment has superseded a previous Selling Costs adoption. Acknowledge replacement to continue.';
    case 'BELOW_SYSTEM_ACK_REQUIRED':
      return 'The Selling Costs proposal is below the current system forecast. Acknowledge the negative replacement adjustment to continue.';
    default:
      return err instanceof SellingCostsApiError
        ? err.message
        : err?.message || 'Could not adopt Selling Costs into the CVR.';
  }
}

function AdoptionConfirmDialog({
  open,
  preview,
  acknowledgeSuperseded,
  acknowledgeBelowSystem,
  onAcknowledgeSuperseded,
  onAcknowledgeBelowSystem,
  needsSupersededAck,
  needsBelowSystemAck,
  adopting,
  error,
  onCancel,
  onConfirm,
}) {
  if (!open || !preview) return null;
  const comparison = preview.comparison || {};
  const proposal = preview.proposal || {};
  const destination = preview.destination || proposal.destination;
  const detailed = proposal.mode === 'detailed';
  const transactionSummary = buildReviewTransactionSummary(
    preview.reconciliation,
    proposal.forecastSellingCosts
  );
  const canConfirm =
    !adopting &&
    (!needsSupersededAck || acknowledgeSuperseded) &&
    (!needsBelowSystemAck || acknowledgeBelowSystem);

  return (
    <div className="dev-cvr-add-backdrop" role="presentation" data-testid="selling-costs-adoption-confirm">
      <div className="dev-cvr-add modal dev-prelims-review__confirm" role="dialog" aria-modal="true">
        <h3>Confirm Selling Costs adoption into {preview.periodKey || 'CVR'}</h3>
        <p className="dev-prelims-review__semantics" data-testid="confirm-replacement-wording">
          The proposed replacement adjustment replaces the current CVR adjustment; it is not added
          to it.
        </p>
        <p className="dev-prelims-review__support" data-testid="confirm-no-budget-system-accrual">
          This adoption does not change budget, system forecast or accrual.
        </p>

        {detailed ? (
          <dl className="dev-selling-costs-review-summary" data-testid="confirm-detailed-summary">
            <div><dt>Detailed proposal</dt><dd>{money(transactionSummary.proposalAmount)}</dd></div>
            <div><dt>Previous positions released</dt><dd>{money(transactionSummary.releaseAmount)}</dd></div>
            <div><dt>Net CVR movement</dt><dd>{signedMoney(transactionSummary.netMovement)}</dd></div>
          </dl>
        ) : <div className="dev-prelims-review__confirm-list">
          <article className="dev-prelims-review__confirm-card" data-testid="confirm-card">
            <h4>
              {comparison.costCodeKey}
              {comparison.costCodeDescription &&
              comparison.costCodeDescription !== comparison.costCodeKey
                ? ` — ${comparison.costCodeDescription}`
                : ''}
            </h4>
            <dl className="dev-prelims-review__metrics">
              <div>
                <dt>Forecast Revenue</dt>
                <dd data-testid="confirm-forecast-revenue">{money(proposal.forecastRevenue)}</dd>
              </div>
              <div>
                <dt>Selling Costs assumption</dt>
                <dd data-testid="confirm-assumption-percent">
                  {formatPercent(proposal.assumptionPercent)}
                </dd>
              </div>
              <div>
                <dt>Proposal target</dt>
                <dd data-testid="confirm-proposal-target">{money(proposal.forecastSellingCosts)}</dd>
              </div>
              <div>
                <dt>Destination</dt>
                <dd data-testid="confirm-destination">
                  {destination?.label || destination?.costCodeKey || comparison.costCodeKey || '—'}
                </dd>
              </div>
              <div>
                <dt>Current system forecast</dt>
                <dd data-testid="confirm-system-forecast">{money(comparison.systemForecast)}</dd>
              </div>
              <div>
                <dt>Current adjustment</dt>
                <dd data-testid="confirm-current-adjustment">
                  {signedMoney(comparison.currentAdjustment)}
                </dd>
              </div>
              <div>
                <dt>Current final forecast</dt>
                <dd data-testid="confirm-current-final">{money(comparison.currentFinalForecast)}</dd>
              </div>
              <div>
                <dt>Proposed replacement adjustment</dt>
                <dd data-testid="confirm-proposed-adjustment">
                  {signedMoney(comparison.proposedReplacementAdjustment)}
                </dd>
              </div>
              <div>
                <dt>Proposed final forecast</dt>
                <dd data-testid="confirm-proposed-final">{money(comparison.proposedFinalForecast)}</dd>
              </div>
              <div>
                <dt>Resulting movement</dt>
                <dd data-testid="confirm-resulting-movement">
                  {signedMoney(comparison.resultingMovement)}
                </dd>
              </div>
              <div>
                <dt>Current accrual (context only)</dt>
                <dd data-testid="confirm-accrual">{money(comparison.currentAccrual)}</dd>
              </div>
            </dl>
            {needsBelowSystemAck ? (
              <p className="dev-prelims-review__warn" data-testid="confirm-below-system">
                The Selling Costs proposal is below the current system forecast. Adopting will write
                a negative replacement adjustment. This does not add a committed/actual floor.
              </p>
            ) : null}
            {needsSupersededAck ? (
              <div className="dev-prelims-review__warn" data-testid="confirm-superseded">
                <p>
                  The current CVR adjustment has been changed since the previous Selling Costs
                  adoption.
                </p>
                <p>
                  Previously adopted adjustment:{' '}
                  {signedMoney(comparison.adoptionMetadata?.adoptedAdjustment)}
                </p>
                <p>Current CVR adjustment: {signedMoney(comparison.currentAdjustment)}</p>
                <p>
                  New proposed replacement adjustment:{' '}
                  {signedMoney(comparison.proposedReplacementAdjustment)}
                </p>
              </div>
            ) : null}
          </article>
        </div>}

        {needsBelowSystemAck ? (
          <label className="dev-prelims-review__ack" data-testid="ack-below-system">
            <input
              type="checkbox"
              checked={acknowledgeBelowSystem}
              disabled={adopting}
              onChange={(event) => onAcknowledgeBelowSystem(event.target.checked)}
            />
            <span>
              I understand the proposed replacement adjustment is negative because the proposal is
              below the current system forecast.
            </span>
          </label>
        ) : null}

        {needsSupersededAck ? (
          <label className="dev-prelims-review__ack" data-testid="ack-superseded">
            <input
              type="checkbox"
              checked={acknowledgeSuperseded}
              disabled={adopting}
              onChange={(event) => onAcknowledgeSuperseded(event.target.checked)}
            />
            <span>I understand this will replace the current CVR adjustment.</span>
          </label>
        ) : null}

        {error ? (
          <p className="dev-workspace__section-lead" role="alert" data-testid="adoption-confirm-error">
            {error}
          </p>
        ) : null}

        <div className="dev-cvr-add__actions modal-actions">
          <button
            type="button"
            className="po-list-btn-secondary"
            onClick={onCancel}
            disabled={adopting}
            data-testid="cancel-adoption"
          >
            Cancel
          </button>
          <button
            type="button"
            className="po-btn-primary"
            onClick={onConfirm}
            disabled={!canConfirm}
            data-testid="confirm-adoption"
          >
            {adopting ? 'Adopting…' : 'Confirm adoption'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DevelopmentSellingCostsCvrReview({ developmentId, onBack }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledgeSuperseded, setAcknowledgeSuperseded] = useState(false);
  const [acknowledgeBelowSystem, setAcknowledgeBelowSystem] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  const load = useCallback(async ({ preserveError = false } = {}) => {
    if (!developmentId) return null;
    setLoading(true);
    if (!preserveError) setError('');
    try {
      const next = await getSellingCostsCvrReview(developmentId);
      setPreview(next);
      return next;
    } catch (err) {
      setPreview(null);
      const message =
        err instanceof SellingCostsApiError
          ? err.message
          : err?.message || 'Could not load Selling Costs review against CVR.';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [developmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const comparison = preview?.comparison || null;
  const comparisons = Array.isArray(preview?.comparisons) && preview.comparisons.length ? preview.comparisons : comparison ? [comparison] : [];
  const proposal = preview?.proposal || null;
  const reconciliationRows = Array.isArray(preview?.reconciliation) && preview.reconciliation.length
    ? preview.reconciliation
    : comparisons.map((item) => ({
        action: item.isUpToDate ? 'unchanged' : item.reviewState === 'superseded' ? 'replace_manual' : 'added',
        costCodeKey: item.costCodeKey,
        costCodeDescription: item.costCodeDescription,
        inputVersion: item.inputVersion,
        currentAdjustment: item.currentAdjustment,
        proposedAdjustment: item.proposedReplacementAdjustment,
        resultingMovement: item.resultingMovement,
        constituentLines: item.constituentLines,
      }));
  const transactionSummary = buildReviewTransactionSummary(
    reconciliationRows,
    proposal?.forecastSellingCosts
  );
  const detailed = proposal?.mode === 'detailed';
  const destination = preview?.destination || proposal?.destination;
  const belowSystem = comparisons.some(item => item?.flags?.proposalBelowSystem);
  const blocked = preview?.reviewStatus === 'blocked';
  const writeEligible = canAdoptFromPreview(preview);
  const needsBelowSystemAck = Boolean(writeEligible && belowSystem && preview?.reviewState !== 'up_to_date');
  const needsSupersededAck = Boolean(writeEligible && (preview?.reviewState === 'superseded' || comparisons.some(item => item?.reviewState === 'superseded')));

  function openConfirm() {
    if (!writeEligible || adopting) return;
    setConfirmError('');
    setAcknowledgeSuperseded(false);
    setAcknowledgeBelowSystem(false);
    setSuccess('');
    setConfirmOpen(true);
  }

  function closeConfirm() {
    if (adopting) return;
    setConfirmOpen(false);
    setConfirmError('');
  }

  async function refreshAfterStale(message) {
    setConfirmOpen(false);
    setConfirmError('');
    setSuccess('');
    setError(message);
    await load({ preserveError: true });
  }

  async function handleConfirmAdoption() {
    if (adopting || !writeEligible) return;
    if (needsBelowSystemAck && !acknowledgeBelowSystem) return;
    if (needsSupersededAck && !acknowledgeSuperseded) return;

    setAdopting(true);
    setConfirmError('');
    setError('');
    setSuccess('');

    const payload = buildAdoptionIntentPayload(preview, {
      acknowledgeSuperseded,
      acknowledgeBelowSystem,
    });

    try {
      const result = await adoptSellingCostsIntoCvr(developmentId, payload);
      setConfirmOpen(false);
      const periodKey = result?.periodKey || preview.periodKey || 'the current CVR';
      const unchanged = Array.isArray(result?.unchanged) && result.unchanged.length && !result?.adopted?.length;
      const committedMessage = unchanged
        ? `Selling Costs already up to date in ${periodKey}.`
        : `Selling Costs were adopted into ${periodKey}.`;
      const affectedPeriodId = result?.periodId || preview?.periodId;
      try {
        await refreshCvrInputsForPeriod(developmentId, affectedPeriodId);
        setSuccess(committedMessage);
      } catch {
        setSuccess(
          `${committedMessage} BuildLite could not refresh the CVR display. Reload the CVR to see the committed position.`
        );
      }
      if (result?.review) {
        setPreview(result.review);
      }
      await load({ preserveError: true });
    } catch (err) {
      const status = err instanceof SellingCostsApiError ? err.status : 0;
      const message = sellingCostsAdoptionConflictMessage(err);
      if (status === 409) {
        await refreshAfterStale(message);
      } else if (status === 400 && (err?.body?.code === 'SUPERSEDED_ACK_REQUIRED' || err?.body?.code === 'BELOW_SYSTEM_ACK_REQUIRED')) {
        setConfirmError(message);
      } else {
        setConfirmOpen(false);
        setError(message);
      }
    } finally {
      setAdopting(false);
    }
  }

  return (
    <section className="dev-prelims-review" data-testid="selling-costs-cvr-review">
      <div className="dev-prelims-review__toolbar">
        <button type="button" className="btn" onClick={onBack} data-testid="back-to-selling-costs">
          Back to Selling Costs
        </button>
        <button type="button" className="btn" onClick={() => load()} disabled={loading || adopting}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <header className="dev-prelims-review__intro">
        <h3>Review against CVR</h3>
        <p>
          Compare the current Selling Costs proposal with its destination CVR line. Numbers stay
          read-only until you choose Adopt into CVR.
        </p>
      </header>

      {loading && !preview ? (
        <p className="dev-selling-costs__muted">Loading Selling Costs review…</p>
      ) : null}
      {error ? (
        <p className="dev-selling-costs__error" role="alert" data-testid="selling-costs-review-error">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="dev-prelims-review__success" role="status" data-testid="selling-costs-adopt-success">
          {success}
        </p>
      ) : null}

      {preview ? (
        <>
          <div className="dev-prelims-review__summary" data-testid="selling-costs-review-summary">
            {detailed ? (
              <>
                <dl className="dev-selling-costs-review-summary" data-testid="detailed-transaction-summary">
                  <div><dt>Detailed Selling Costs proposal</dt><dd>{money(transactionSummary.proposalAmount)}</dd></div>
                  <div><dt>Previous Selling Costs to release</dt><dd>{money(transactionSummary.releaseAmount)}</dd></div>
                  <div><dt>Net CVR movement</dt><dd className={transactionSummary.netMovement > 0 ? 'dev-prelims-review__delta--up' : transactionSummary.netMovement < 0 ? 'dev-prelims-review__delta--down' : undefined} data-testid="review-net-movement">{signedMoney(transactionSummary.netMovement)}</dd></div>
                </dl>
                <p className="dev-prelims-review__hero" data-testid="review-transaction-counts">
                  {transactionSummary.destinationCount} destination{transactionSummary.destinationCount === 1 ? '' : 's'} adopted {'\u00b7'} {transactionSummary.releaseCount} released
                </p>
              </>
            ) : <dl className="dev-selling-costs__summary">
              <div>
                <dt>Forecast Revenue</dt>
                <dd data-testid="review-forecast-revenue">{money(proposal?.forecastRevenue)}</dd>
              </div>
              <div>
                <dt>Selling Costs assumption</dt>
                <dd data-testid="review-assumption-percent">
                  {formatPercent(proposal?.assumptionPercent)}
                </dd>
              </div>
              <div>
                <dt>Selling Costs proposal</dt>
                <dd data-testid="review-proposal-amount">{money(proposal?.forecastSellingCosts)}</dd>
              </div>
              <div>
                <dt>CVR destinations</dt>
                <dd data-testid="review-destination">
                  {proposal?.mode === 'detailed' ? `${comparisons.length} destination${comparisons.length === 1 ? '' : 's'}` : destination?.label || destination?.costCodeKey || '—'}
                </dd>
              </div>
              <div>
                <dt>Review state</dt>
                <dd data-testid="review-state">{stateLabel(preview)}</dd>
              </div>
            </dl>}
            {!detailed && preview.headline ? (
              <p className="dev-prelims-review__hero" data-testid="review-hero-headline">
                {preview.headline}
              </p>
            ) : null}
            <p className="dev-prelims-review__semantics">{preview.adjustmentSemantics}</p>
            <p className="dev-prelims-review__support">{preview.accrualNote}</p>
            {!isPeriodDraft(preview) && preview.reviewStatus === 'ready' ? (
              <p className="dev-prelims-review__warn" role="status" data-testid="period-not-draft">
                Adoption is unavailable because the open CVR period is no longer Draft.
              </p>
            ) : null}
          </div>

          {blocked ? (
            <article
              className="dev-prelims-review__card dev-prelims-review__card--missing"
              data-testid="selling-costs-review-blocked"
            >
              <span className="dev-prelims-review__flag">{stateLabel(preview)}</span>
              <p className="dev-prelims-review__missing-banner" role="status">
                {preview.blockedReason?.message || 'This Selling Costs proposal cannot be reviewed against the CVR yet.'}
              </p>
            </article>
          ) : null}

          {!detailed ? comparisons.map((comparison, comparisonIndex) => (
            <article
              className={`dev-prelims-review__card${
                belowSystem ? ' dev-prelims-review__card--below' : ''
              }`}
              data-testid="selling-costs-review-card"
              key={comparison.costCodeKey || comparisonIndex}
            >
              <header className="dev-prelims-review__card-head">
                <div>
                  <h4>
                    {comparison.costCodeKey}
                    {comparison.costCodeDescription &&
                    comparison.costCodeDescription !== comparison.costCodeKey
                      ? ` · ${comparison.costCodeDescription}`
                      : ''}
                  </h4>
                </div>
                <div className="dev-prelims-review__chips">
                  <span className="dev-prelims-review__flag" data-testid="review-state-chip">
                    {stateLabel(preview)}
                  </span>
                  {belowSystem ? (
                    <span className="dev-prelims-review__flag" data-testid="proposal-below-system">
                      Proposal below system forecast
                    </span>
                  ) : null}
                </div>
              </header>

              <dl className="dev-prelims-review__metrics">
                <div>
                  <dt>Cost code</dt>
                  <dd data-testid="review-cost-code">{comparison.costCodeKey}</dd>
                </div>
                <div>
                  <dt>System forecast</dt>
                  <dd data-testid="review-system-forecast">{money(comparison.systemForecast)}</dd>
                </div>
                <div>
                  <dt>Current commercial adjustment</dt>
                  <dd data-testid="review-current-adjustment">
                    {signedMoney(comparison.currentAdjustment)}
                  </dd>
                </div>
                <div>
                  <dt>Current final forecast</dt>
                  <dd data-testid="review-current-final">
                    {money(comparison.currentFinalForecast)}
                  </dd>
                </div>
                <div>
                  <dt>Proposed replacement adjustment</dt>
                  <dd data-testid="review-proposed-adjustment">
                    {signedMoney(comparison.proposedReplacementAdjustment)}
                  </dd>
                </div>
                <div>
                  <dt>Proposed final forecast</dt>
                  <dd data-testid="review-proposed-final">
                    {money(comparison.proposedFinalForecast)}
                  </dd>
                </div>
                <div>
                  <dt>Resulting movement</dt>
                  <dd
                    className={
                      comparison.resultingMovement > 0
                        ? 'dev-prelims-review__delta--up'
                        : comparison.resultingMovement < 0
                          ? 'dev-prelims-review__delta--down'
                          : undefined
                    }
                    data-testid="review-resulting-movement"
                  >
                    {signedMoney(comparison.resultingMovement)}
                  </dd>
                </div>
                <div>
                  <dt>Current accrual (context only)</dt>
                  <dd data-testid="review-accrual">{money(comparison.currentAccrual)}</dd>
                </div>
              </dl>
            </article>
          )) : null}

          <ReconciliationRows rows={reconciliationRows} comparisons={comparisons} />

          {writeEligible ? (
            <div className="dev-prelims-review__actions dev-selling-costs-review__final-actions" data-testid="selling-costs-adopt-actions">
              <div>
                {detailed ? <strong>Net CVR movement: {signedMoney(transactionSummary.netMovement)}</strong> : null}
                <p>{detailed ? 'This will replace the current Selling Costs-owned CVR positions with the reviewed Detailed Selling Costs forecast.' : 'Adoption uses the reviewed replacement adjustment and leaves budget, System Forecast and accrual unchanged.'}</p>
              </div>
              <div className="dev-selling-costs-review__buttons">
                <button type="button" className="po-list-btn-secondary" onClick={onBack}>Back to Selling Costs</button>
                <button type="button" className="po-btn-primary" onClick={openConfirm} disabled={adopting} data-testid="selling-costs-adopt">
                  {detailed ? 'Adopt Detailed Selling Costs into CVR' : 'Adopt into CVR'}
                </button>
              </div>
            </div>
          ) : null}

          <AdoptionConfirmDialog
            open={confirmOpen}
            preview={preview}
            acknowledgeSuperseded={acknowledgeSuperseded}
            acknowledgeBelowSystem={acknowledgeBelowSystem}
            onAcknowledgeSuperseded={setAcknowledgeSuperseded}
            onAcknowledgeBelowSystem={setAcknowledgeBelowSystem}
            needsSupersededAck={needsSupersededAck}
            needsBelowSystemAck={needsBelowSystemAck}
            adopting={adopting}
            error={confirmError}
            onCancel={closeConfirm}
            onConfirm={handleConfirmAdoption}
          />
        </>
      ) : null}
    </section>
  );
}
