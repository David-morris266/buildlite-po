/**
 * BL-034C — Read-only Selling Costs Review against CVR.
 * No Adopt. No Add to CVR. GET-only.
 */

import { useCallback, useEffect, useState } from 'react';
import { formatCvrMoney } from '../cvr/cvrHelpers';
import { getSellingCostsCvrReview, SellingCostsApiError } from '../api/sellingCosts';

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

export default function DevelopmentSellingCostsCvrReview({ developmentId, onBack }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!developmentId) return;
    setLoading(true);
    setError('');
    try {
      const next = await getSellingCostsCvrReview(developmentId);
      setPreview(next);
    } catch (err) {
      setPreview(null);
      setError(
        err instanceof SellingCostsApiError
          ? err.message
          : err?.message || 'Could not load Selling Costs review against CVR.'
      );
    } finally {
      setLoading(false);
    }
  }, [developmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const comparison = preview?.comparison || null;
  const proposal = preview?.proposal || null;
  const destination = preview?.destination || proposal?.destination;
  const belowSystem = Boolean(comparison?.flags?.proposalBelowSystem);
  const blocked = preview?.reviewStatus === 'blocked';

  return (
    <section className="dev-prelims-review" data-testid="selling-costs-cvr-review">
      <div className="dev-prelims-review__toolbar">
        <button type="button" className="btn" onClick={onBack} data-testid="back-to-selling-costs">
          Back to Selling Costs
        </button>
        <button type="button" className="btn" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <header className="dev-prelims-review__intro">
        <h3>Review against CVR</h3>
        <p>
          Read-only comparison of the current Selling Costs proposal with its destination CVR line.
          This does not adopt, create membership, or change the CVR.
        </p>
      </header>

      {loading && !preview ? (
        <p className="dev-selling-costs__muted">Loading Selling Costs review…</p>
      ) : null}
      {error ? (
        <p className="dev-selling-costs__error" role="alert">
          {error}
        </p>
      ) : null}

      {preview ? (
        <>
          <div className="dev-prelims-review__summary" data-testid="selling-costs-review-summary">
            <dl className="dev-selling-costs__summary">
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
                <dt>Destination cost code</dt>
                <dd data-testid="review-destination">
                  {destination?.label || destination?.costCodeKey || '—'}
                </dd>
              </div>
              <div>
                <dt>Review state</dt>
                <dd data-testid="review-state">{stateLabel(preview)}</dd>
              </div>
            </dl>
            {preview.headline ? (
              <p className="dev-prelims-review__hero" data-testid="review-hero-headline">
                {preview.headline}
              </p>
            ) : null}
            <p className="dev-prelims-review__semantics">{preview.adjustmentSemantics}</p>
            <p className="dev-prelims-review__support">{preview.accrualNote}</p>
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

          {comparison ? (
            <article
              className={`dev-prelims-review__card${
                belowSystem ? ' dev-prelims-review__card--below' : ''
              }`}
              data-testid="selling-costs-review-card"
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
          ) : null}

          <p className="dev-prelims-review__support" data-testid="selling-costs-no-adopt">
            Adoption into the Draft CVR is a later deliberate step. This review does not write
            anything.
          </p>
        </>
      ) : null}
    </section>
  );
}
