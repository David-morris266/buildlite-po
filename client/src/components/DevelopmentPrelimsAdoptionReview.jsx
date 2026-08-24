/**
 * BL-033D.x.4B — Read-only Prelims Review against CVR commercial preview UI.
 * Does not adopt, adjust, or write CVR / Prelims / metadata.
 */

import { useEffect, useState } from 'react';
import {
  DevelopmentPrelimsApiError,
  previewDevelopmentPrelimsAdoption,
} from '../api/developmentPrelimsItems';
import { formatCvrMoney } from '../cvr/cvrHelpers';
import { PRELIMS_ADOPTION_FLAG_KEYS } from '../prelims/prelimsAdoptionCompare';

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

function headlineForCandidate(row) {
  if (!row || row.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW]) return null;
  return `Prelims proposal ${money(row.resolvedPrelimsTotal)} → CVR final forecast ${money(
    row.currentFinalForecast
  )} → proposed final ${money(row.proposedFinalForecast)} (${signedMoney(row.deltaFinal)})`;
}

function CostCodeReviewCard({ row }) {
  const belowSystem = row.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.PROPOSAL_BELOW_SYSTEM];
  const unresolved = row.unresolvedCount > 0;

  return (
    <article
      className={`dev-prelims-review__card${belowSystem ? ' dev-prelims-review__card--below' : ''}`}
      data-cost-code={row.costCodeKey}
      data-testid={`prelims-review-card-${row.costCodeKey}`}
    >
      <header className="dev-prelims-review__card-head">
        <div>
          <h4>
            {row.costCodeKey}
            {row.costCodeDescription && row.costCodeDescription !== row.costCodeKey
              ? ` · ${row.costCodeDescription}`
              : ''}
          </h4>
          {headlineForCandidate(row) ? (
            <p className="dev-prelims-review__card-headline">{headlineForCandidate(row)}</p>
          ) : null}
        </div>
        {belowSystem ? (
          <span className="dev-prelims-review__flag" data-testid="proposal-below-system">
            Proposal below system forecast
          </span>
        ) : null}
      </header>

      <dl className="dev-prelims-review__metrics">
        <div>
          <dt>Resolved Prelims proposal</dt>
          <dd>{money(row.resolvedPrelimsTotal)}</dd>
        </div>
        <div>
          <dt>Unresolved Prelims lines</dt>
          <dd>{row.unresolvedCount || 0}</dd>
        </div>
        <div>
          <dt>CVR system forecast</dt>
          <dd>{money(row.systemForecast)}</dd>
        </div>
        <div>
          <dt>Current CVR adjustment</dt>
          <dd>{signedMoney(row.currentAdjustment)}</dd>
        </div>
        <div>
          <dt>Current final forecast</dt>
          <dd>{money(row.currentFinalForecast)}</dd>
        </div>
        <div>
          <dt>Proposed replacement adjustment</dt>
          <dd data-testid={`proposed-adjustment-${row.costCodeKey}`}>
            {signedMoney(row.proposedAdjustment)}
          </dd>
        </div>
        <div>
          <dt>Proposed final forecast</dt>
          <dd>{money(row.proposedFinalForecast)}</dd>
        </div>
        <div>
          <dt>Resulting movement in final forecast</dt>
          <dd
            className={
              row.deltaFinal > 0
                ? 'dev-prelims-review__delta--up'
                : row.deltaFinal < 0
                  ? 'dev-prelims-review__delta--down'
                  : undefined
            }
            data-testid={`delta-final-${row.costCodeKey}`}
          >
            {signedMoney(row.deltaFinal)}
          </dd>
        </div>
        {row.manualAccrual != null ? (
          <div>
            <dt>Accrual (context only)</dt>
            <dd>{money(row.manualAccrual)}</dd>
          </div>
        ) : null}
      </dl>

      <p className="dev-prelims-review__semantics" data-testid="adjustment-semantics">
        The proposed replacement adjustment replaces the current CVR adjustment (system +
        replacement = proposed final). It is not added on top of the existing adjustment.
      </p>

      {unresolved ? (
        <div
          className="dev-prelims-review__unresolved"
          data-testid={`unresolved-block-${row.costCodeKey}`}
        >
          <p className="dev-prelims-review__unresolved-banner">
            {row.unresolvedExcludedMessage ||
              `${row.unresolvedCount} unresolved line${
                row.unresolvedCount === 1 ? '' : 's'
              } excluded from proposed CVR value`}
          </p>
          <ul>
            {(row.unresolvedLines || []).map((line) => (
              <li key={line.id}>
                <strong>{line.name}</strong>
                <span> — unresolved</span>
                {line.reasonLabel ? <span>: {line.reasonLabel}</span> : null}
                <span className="dev-prelims-review__excluded-note">
                  {' '}
                  Excluded from the proposed CVR value (not treated as £0).
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(row.includedLines || []).length ? (
        <div className="dev-prelims-review__included">
          <h5>Included in proposal</h5>
          <ul>
            {row.includedLines.map((line) => (
              <li key={line.id}>
                {line.name}
                {line.totalForecast != null ? ` · ${money(line.totalForecast)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function MissingCvrCard({ row }) {
  return (
    <article
      className="dev-prelims-review__card dev-prelims-review__card--missing"
      data-cost-code={row.costCodeKey}
      data-testid={`prelims-review-missing-${row.costCodeKey}`}
    >
      <header className="dev-prelims-review__card-head">
        <h4>
          {row.costCodeKey}
          {row.costCodeDescription && row.costCodeDescription !== row.costCodeKey
            ? ` · ${row.costCodeDescription}`
            : ''}
        </h4>
      </header>
      <p className="dev-prelims-review__missing-banner" role="status">
        {row.missingFromCvrMessage ||
          'Cannot review against CVR — cost code is not present in the current CVR.'}
      </p>
      <dl className="dev-prelims-review__metrics">
        <div>
          <dt>Resolved Prelims proposal</dt>
          <dd>{money(row.resolvedPrelimsTotal)}</dd>
        </div>
        <div>
          <dt>Unresolved Prelims lines</dt>
          <dd>{row.unresolvedCount || 0}</dd>
        </div>
      </dl>
      <p className="dev-prelims-review__support">
        This cost code is not on the open CVR worksheet. No CVR row is created by this review.
      </p>
    </article>
  );
}

export default function DevelopmentPrelimsAdoptionReview({ developmentId, onBack }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    previewDevelopmentPrelimsAdoption(developmentId)
      .then((doc) => {
        if (!cancelled) setPreview(doc);
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof DevelopmentPrelimsApiError
            ? err.message
            : err?.message || 'Could not load Prelims review against CVR.';
        setError(message);
        setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [developmentId]);

  const summary = preview?.summary;
  const primary = (preview?.candidates || [])[0] || null;
  const missingRows = preview?.missingFromCvr || [];
  const allReviewRows = [...(preview?.candidates || []), ...missingRows];
  const notOnCvrTotal = missingRows.reduce((total, row) => {
    if (row.resolvedPrelimsTotal == null) return total;
    return total + (Number(row.resolvedPrelimsTotal) || 0);
  }, 0);
  const unresolvedLineCount = allReviewRows.reduce(
    (total, row) => total + (Number(row.unresolvedCount) || 0),
    0
  );
  const unresolvedLineLabel =
    unresolvedLineCount === 1
      ? '1 unresolved line'
      : `${unresolvedLineCount} unresolved lines`;

  return (
    <section className="dev-prelims-review" data-testid="prelims-adoption-review">
      <div className="dev-prelims-review__toolbar">
        <button className="btn" type="button" onClick={onBack} data-testid="back-to-prelims">
          Back to Prelims
        </button>
      </div>

      <header className="dev-prelims-review__intro">
        <h3>Review against CVR</h3>
        <p>
          Commercial preview of the Prelims proposal against the current open CVR worksheet. This
          view is read-only — nothing is adopted or written.
        </p>
      </header>

      {loading ? (
        <p className="dev-workspace__section-lead">Loading review…</p>
      ) : null}

      {error ? (
        <p className="dev-workspace__section-lead" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && preview ? (
        <>
          <div className="dev-prelims-review__summary" data-testid="prelims-review-summary">
            <dl className="dev-prelims__context" data-testid="prelims-proposal-split">
              <div>
                <dt>Open CVR</dt>
                <dd>
                  {preview.periodKey || '—'}
                  {preview.periodStatus ? ` · ${preview.periodStatus}` : ''}
                </dd>
              </div>
              <div>
                <dt>Reporting month</dt>
                <dd>{preview.reportingMonth || '—'}</dd>
              </div>
              <div>
                <dt>Total resolved Prelims</dt>
                <dd data-testid="summary-total-resolved">
                  {money(summary?.resolvedPrelimsTotal)}
                </dd>
              </div>
              <div>
                <dt>Reviewable against CVR</dt>
                <dd data-testid="summary-reviewable">
                  {money(summary?.proposedFinalForecastTotal)}
                </dd>
              </div>
              <div>
                <dt>Not on current CVR</dt>
                <dd data-testid="summary-not-on-cvr">
                  {missingRows.length ? money(notOnCvrTotal) : money(0)}
                </dd>
              </div>
              <div>
                <dt>Unresolved</dt>
                <dd data-testid="summary-unresolved">{unresolvedLineLabel}</dd>
              </div>
            </dl>

            <dl className="dev-prelims__context" data-testid="prelims-cvr-comparison">
              <div>
                <dt>Current final forecast (reviewed cost codes)</dt>
                <dd>{money(summary?.currentFinalForecastTotal)}</dd>
              </div>
              <div>
                <dt>Proposed final forecast (reviewed cost codes)</dt>
                <dd>{money(summary?.proposedFinalForecastTotal)}</dd>
              </div>
              <div>
                <dt>Resulting movement in final forecast</dt>
                <dd>{signedMoney(summary?.deltaFinalTotal)}</dd>
              </div>
            </dl>

            {primary && !primary.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW] ? (
              <p className="dev-prelims-review__hero" data-testid="review-hero-headline">
                {headlineForCandidate(primary)}
              </p>
            ) : null}

            <p className="dev-prelims-review__semantics">
              {preview.adjustmentSemantics ||
                'The proposed replacement adjustment replaces the current CVR adjustment; it is not added to it.'}
            </p>
            <p className="dev-prelims-review__support">{preview.accrualNote}</p>
          </div>

          <div className="dev-prelims-review__list">
            <h4>Cost-code review</h4>
            {(preview.candidates || []).map((row) => (
              <CostCodeReviewCard key={row.costCodeKey} row={row} />
            ))}
          </div>

          {(preview.missingFromCvr || []).length ? (
            <div className="dev-prelims-review__missing" data-testid="missing-from-cvr">
              <h4>Not on current CVR</h4>
              {(preview.missingFromCvr || []).map((row) => (
                <MissingCvrCard key={row.costCodeKey} row={row} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export { headlineForCandidate, signedMoney };
