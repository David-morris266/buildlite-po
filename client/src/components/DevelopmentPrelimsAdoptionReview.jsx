/**
 * BL-033D.x.4B / x.4C.2 — Prelims Review against CVR + explicit adoption UI.
 * Adoption writes only via confirmed POST to the banked x.4C.1 command.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DevelopmentPrelimsApiError,
  adoptDevelopmentPrelimsIntoCvr,
  previewDevelopmentPrelimsAdoption,
} from '../api/developmentPrelimsItems';
import { formatCvrMoney } from '../cvr/cvrHelpers';
import {
  membershipAddUserMessage,
} from '../cvr/cvrPeriodAuthorityWrites';
import { addServerCvrCostCodeMember } from '../cvr/cvrPeriodServerMutations';
import {
  PRELIMS_ADOPTION_DRIFT_STATES,
  PRELIMS_ADOPTION_FLAG_KEYS,
} from '../prelims/prelimsAdoptionCompare';

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

function isUpToDate(row) {
  return Boolean(
    row?.isUpToDate || row?.driftState === PRELIMS_ADOPTION_DRIFT_STATES.UP_TO_DATE
  );
}

function isSuperseded(row) {
  return row?.driftState === PRELIMS_ADOPTION_DRIFT_STATES.ADOPTION_SUPERSEDED;
}

function isPeriodDraft(preview) {
  return String(preview?.periodStatus || '').toLowerCase() === 'draft';
}

function isSelectableCandidate(row, preview) {
  if (!row) return false;
  if (!isPeriodDraft(preview)) return false;
  if (row.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW]) return false;
  if (row.cannotAdopt || row.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.CANNOT_ADOPT]) return false;
  if (isUpToDate(row)) return false;
  if (row.inputVersion == null || !Number.isInteger(Number(row.inputVersion))) return false;
  if (!row.proposalFingerprint) return false;
  return true;
}

function buildSelectionPayload(row, { acknowledgeUnresolved, acknowledgeSuperseded }) {
  return {
    costCodeKey: row.costCodeKey,
    proposalFingerprint: row.proposalFingerprint,
    expectedInputVersion: Number(row.inputVersion),
    expectedSystemForecast: row.systemForecast,
    expectedCurrentAdjustment: row.currentAdjustment,
    acknowledgeUnresolvedExcluded: Boolean(
      row.unresolvedCount > 0 && acknowledgeUnresolved
    ),
    acknowledgeSupersededAdjustment: Boolean(
      isSuperseded(row) && acknowledgeSuperseded
    ),
  };
}

function CostCodeReviewCard({
  row,
  selectable,
  selected,
  onToggle,
  disabled,
}) {
  const belowSystem = row.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.PROPOSAL_BELOW_SYSTEM];
  const unresolved = row.unresolvedCount > 0;
  const upToDate = isUpToDate(row);
  const superseded = isSuperseded(row);

  return (
    <article
      className={`dev-prelims-review__card${belowSystem ? ' dev-prelims-review__card--below' : ''}${
        selected ? ' dev-prelims-review__card--selected' : ''
      }`}
      data-cost-code={row.costCodeKey}
      data-testid={`prelims-review-card-${row.costCodeKey}`}
    >
      <header className="dev-prelims-review__card-head">
        <div className="dev-prelims-review__card-title">
          {selectable ? (
            <label className="dev-prelims-review__select">
              <input
                type="checkbox"
                checked={selected}
                disabled={disabled}
                onChange={() => onToggle?.(row.costCodeKey)}
                aria-label={`Select ${row.costCodeKey}`}
                data-testid={`select-cost-code-${row.costCodeKey}`}
              />
            </label>
          ) : null}
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
        </div>
        <div className="dev-prelims-review__chips">
          {upToDate ? (
            <span className="dev-prelims-review__flag" data-testid={`already-adopted-${row.costCodeKey}`}>
              Already adopted — no change
            </span>
          ) : null}
          {superseded ? (
            <span className="dev-prelims-review__flag" data-testid={`superseded-${row.costCodeKey}`}>
              Manual adjustment superseded prior adoption
            </span>
          ) : null}
          {belowSystem ? (
            <span className="dev-prelims-review__flag" data-testid="proposal-below-system">
              Proposal below system forecast
            </span>
          ) : null}
        </div>
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

function canAddMissingToCvr(row, preview) {
  if (!row || !isPeriodDraft(preview)) return false;
  if (row.canAddToCvr === true) return true;
  return false;
}

function MissingCvrCard({
  row,
  canAdd,
  adding,
  disabled,
  onAdd,
}) {
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
        <span className="dev-prelims-review__flag">Not on current CVR</span>
      </header>
      <p className="dev-prelims-review__missing-banner" role="status">
        {row.missingFromCvrMessage ||
          'This Prelims proposal uses a cost code that is not currently included as a CVR line.'}
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
      {canAdd ? (
        <div className="dev-prelims-review__add-actions">
          <button
            type="button"
            className="po-btn-primary"
            onClick={() => onAdd?.(row)}
            disabled={disabled || adding}
            data-testid={`add-to-cvr-${row.costCodeKey}`}
          >
            {adding ? 'Adding…' : 'Add to CVR'}
          </button>
        </div>
      ) : row.addBlockedReason ? (
        <p className="dev-prelims-review__support" data-testid={`add-blocked-${row.costCodeKey}`}>
          {row.addBlockedReason}
        </p>
      ) : (
        <p className="dev-prelims-review__support">
          This cost code cannot be added to the current CVR.
        </p>
      )}
    </article>
  );
}

function AdoptionConfirmDialog({
  open,
  rows,
  periodKey,
  acknowledgeUnresolved,
  acknowledgeSuperseded,
  onAcknowledgeUnresolved,
  onAcknowledgeSuperseded,
  needsUnresolvedAck,
  needsSupersededAck,
  adopting,
  error,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;

  const canConfirm =
    !adopting &&
    (!needsUnresolvedAck || acknowledgeUnresolved) &&
    (!needsSupersededAck || acknowledgeSuperseded);

  return (
    <div className="dev-cvr-add-backdrop" role="presentation" data-testid="adoption-confirm-dialog">
      <div className="dev-cvr-add modal dev-prelims-review__confirm" role="dialog" aria-modal="true">
        <h3>Confirm Prelims adoption into {periodKey || 'CVR'}</h3>
        <p className="dev-prelims-review__semantics" data-testid="confirm-replacement-wording">
          The proposed replacement adjustment replaces the current CVR adjustment. It is not added
          to it.
        </p>

        <div className="dev-prelims-review__confirm-list">
          {rows.map((row) => (
            <article
              key={row.costCodeKey}
              className="dev-prelims-review__confirm-card"
              data-testid={`confirm-card-${row.costCodeKey}`}
            >
              <h4>
                {row.costCodeKey}
                {row.costCodeDescription && row.costCodeDescription !== row.costCodeKey
                  ? ` — ${row.costCodeDescription}`
                  : ''}
              </h4>
              <dl className="dev-prelims-review__metrics">
                <div>
                  <dt>Resolved Prelims proposal</dt>
                  <dd>{money(row.resolvedPrelimsTotal)}</dd>
                </div>
                <div>
                  <dt>Current system forecast</dt>
                  <dd>{money(row.systemForecast)}</dd>
                </div>
                <div>
                  <dt>Current adjustment</dt>
                  <dd>{signedMoney(row.currentAdjustment)}</dd>
                </div>
                <div>
                  <dt>Current final forecast</dt>
                  <dd>{money(row.currentFinalForecast)}</dd>
                </div>
                <div>
                  <dt>Proposed replacement adjustment</dt>
                  <dd>{signedMoney(row.proposedAdjustment)}</dd>
                </div>
                <div>
                  <dt>Proposed final forecast</dt>
                  <dd>{money(row.proposedFinalForecast)}</dd>
                </div>
                <div>
                  <dt>Resulting movement in final forecast</dt>
                  <dd>{signedMoney(row.deltaFinal)}</dd>
                </div>
              </dl>
              {isSuperseded(row) ? (
                <div
                  className="dev-prelims-review__warn"
                  data-testid={`confirm-superseded-${row.costCodeKey}`}
                >
                  <p>
                    This CVR adjustment has been changed since the previous Prelims adoption.
                  </p>
                  <p>
                    Previously adopted adjustment: {signedMoney(row.adoptionMetadata?.adoptedAdjustment)}
                  </p>
                  <p>Current CVR adjustment: {signedMoney(row.currentAdjustment)}</p>
                  <p>
                    New proposed replacement adjustment: {signedMoney(row.proposedAdjustment)}
                  </p>
                </div>
              ) : null}
              {row.unresolvedCount > 0 ? (
                <p
                  className="dev-prelims-review__warn"
                  data-testid={`confirm-unresolved-${row.costCodeKey}`}
                >
                  {row.unresolvedCount} unresolved Prelims line
                  {row.unresolvedCount === 1 ? '' : 's'}{' '}
                  {row.unresolvedCount === 1 ? 'is' : 'are'} excluded from this adoption and{' '}
                  {row.unresolvedCount === 1 ? 'is' : 'are'} not treated as £0.
                </p>
              ) : null}
            </article>
          ))}
        </div>

        {needsUnresolvedAck ? (
          <label className="dev-prelims-review__ack" data-testid="ack-unresolved">
            <input
              type="checkbox"
              checked={acknowledgeUnresolved}
              disabled={adopting}
              onChange={(event) => onAcknowledgeUnresolved(event.target.checked)}
            />
            <span>I understand the unresolved line is excluded from the adopted value.</span>
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
            data-testid="adoption-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className="po-btn-primary"
            onClick={onConfirm}
            disabled={!canConfirm}
            data-testid="adoption-confirm"
          >
            {adopting ? 'Adopting…' : 'Confirm adoption'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DevelopmentPrelimsAdoptionReview({ developmentId, onBack }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledgeUnresolved, setAcknowledgeUnresolved] = useState(false);
  const [acknowledgeSuperseded, setAcknowledgeSuperseded] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [addingKey, setAddingKey] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const loadPreview = useCallback(async ({ preserveError = false } = {}) => {
    setLoading(true);
    if (!preserveError) setError('');
    try {
      const doc = await previewDevelopmentPrelimsAdoption(developmentId);
      setPreview(doc);
      return doc;
    } catch (err) {
      const message =
        err instanceof DevelopmentPrelimsApiError
          ? err.message
          : err?.message || 'Could not load Prelims review against CVR.';
      setError(message);
      setPreview(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [developmentId]);

  useEffect(() => {
    let cancelled = false;
    setSelectedKeys(new Set());
    setConfirmOpen(false);
    setAcknowledgeUnresolved(false);
    setAcknowledgeSuperseded(false);
    setConfirmError('');
    (async () => {
      const doc = await loadPreview();
      if (cancelled) return;
      if (!doc) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [developmentId, reloadToken, loadPreview]);

  const candidates = preview?.candidates || [];
  const missingRows = preview?.missingFromCvr || [];
  const draftPeriod = isPeriodDraft(preview);

  const eligibleRows = useMemo(
    () => candidates.filter((row) => isSelectableCandidate(row, preview)),
    [candidates, preview]
  );

  const selectedRows = useMemo(
    () => candidates.filter((row) => selectedKeys.has(row.costCodeKey)),
    [candidates, selectedKeys]
  );

  const needsUnresolvedAck = selectedRows.some((row) => row.unresolvedCount > 0);
  const needsSupersededAck = selectedRows.some((row) => isSuperseded(row));

  const summary = preview?.summary;
  const primary = candidates[0] || null;
  const allReviewRows = [...candidates, ...missingRows];
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

  function toggleKey(costCodeKey) {
    setSuccess('');
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(costCodeKey)) next.delete(costCodeKey);
      else next.add(costCodeKey);
      return next;
    });
  }

  function selectAllEligible() {
    setSuccess('');
    setSelectedKeys(new Set(eligibleRows.map((row) => row.costCodeKey)));
  }

  function clearSelection() {
    setSelectedKeys(new Set());
    setAcknowledgeUnresolved(false);
    setAcknowledgeSuperseded(false);
  }

  function openConfirm() {
    if (!selectedRows.length || adopting) return;
    setConfirmError('');
    setAcknowledgeUnresolved(false);
    setAcknowledgeSuperseded(false);
    setConfirmOpen(true);
  }

  function closeConfirm() {
    if (adopting) return;
    setConfirmOpen(false);
    setConfirmError('');
  }

  async function handleAddToCvr(row) {
    if (addingKey || adopting || !preview?.periodId || !row?.costCodeKey) return;
    if (!canAddMissingToCvr(row, preview)) return;

    const key = row.costCodeKey;
    setAddingKey(key);
    setError('');
    setSuccess('');

    try {
      const result = await addServerCvrCostCodeMember(developmentId, preview.periodId, {
        costCodeKey: key,
      });

      if (result?.ok) {
        setSuccess(`${key} added to ${preview.periodKey || 'the current CVR'}.`);
        await loadPreview({ preserveError: true });
        return;
      }

      if (result?.code === 'COST_CODE_ALREADY_MEMBER') {
        setSuccess(`${key} is already on ${preview.periodKey || 'the current CVR'}.`);
        await loadPreview({ preserveError: true });
        return;
      }

      if (result?.code === 'PERIOD_NOT_DRAFT') {
        setError(membershipAddUserMessage(result));
        await loadPreview({ preserveError: true });
        return;
      }

      setError(membershipAddUserMessage(result, 'Could not add this cost code to the CVR.'));
    } finally {
      setAddingKey('');
    }
  }

  async function refreshAfterStale(message) {
    setConfirmOpen(false);
    setConfirmError('');
    clearSelection();
    setSuccess('');
    setError(message);
    // Preserve the stale/conflict message while reloading GET review — do not
    // bump reloadToken (that path clears error via the initial-load effect).
    await loadPreview({ preserveError: true });
  }

  async function handleConfirmAdoption() {
    if (adopting || !preview?.periodId || !selectedRows.length) return;
    if (needsUnresolvedAck && !acknowledgeUnresolved) return;
    if (needsSupersededAck && !acknowledgeSuperseded) return;

    setAdopting(true);
    setConfirmError('');
    setError('');
    setSuccess('');

    const payload = {
      expectedPeriodKey: preview.periodKey,
      expectedReportingMonth: preview.reportingMonth,
      selections: selectedRows.map((row) =>
        buildSelectionPayload(row, {
          acknowledgeUnresolved,
          acknowledgeSuperseded,
        })
      ),
    };

    try {
      const result = await adoptDevelopmentPrelimsIntoCvr(
        developmentId,
        preview.periodId,
        payload
      );
      const adoptedCount = Array.isArray(result?.adopted) ? result.adopted.length : selectedRows.length;
      setConfirmOpen(false);
      clearSelection();
      setSuccess(
        `${adoptedCount} Prelims cost code${adoptedCount === 1 ? '' : 's'} adopted into ${
          preview.periodKey || 'CVR'
        }.`
      );
      setReloadToken((token) => token + 1);
    } catch (err) {
      const code = err?.body?.code || null;
      const status = err?.status || 0;

      if (status === 409) {
        const staleMessage =
          code === 'PERIOD_NOT_DRAFT'
            ? 'Adoption is no longer available because the CVR period is no longer Draft. The page has been refreshed.'
            : 'The CVR or Prelims changed after this review. The page has been refreshed. Please review the updated figures before adopting.';
        await refreshAfterStale(staleMessage);
        return;
      }

      if (
        code === 'COST_CODE_NOT_ON_CVR' ||
        code === 'SELECTION_REQUIRED' ||
        code === 'DUPLICATE_COST_CODE'
      ) {
        setConfirmError(err.message || 'Adoption request was rejected.');
        clearSelection();
        setReloadToken((token) => token + 1);
        return;
      }

      if (code === 'UNRESOLVED_ACK_REQUIRED' || code === 'SUPERSEDED_ACK_REQUIRED') {
        setConfirmError(err.message || 'Acknowledgement is required before adoption.');
        return;
      }

      setConfirmError(err.message || 'Could not adopt Prelims into the CVR.');
    } finally {
      setAdopting(false);
    }
  }

  return (
    <section className="dev-prelims-review" data-testid="prelims-adoption-review">
      <div className="dev-prelims-review__toolbar">
        <button className="btn" type="button" onClick={onBack} data-testid="back-to-prelims">
          Back to Prelims
        </button>
      </div>

      <header className="dev-prelims-review__intro">
        <h3>Review against CVR</h3>
        <p data-testid="review-intro-copy">
          Commercial preview of the Prelims proposal against the current open CVR worksheet. This
          review does not change the CVR until you explicitly select cost codes and confirm
          adoption.
        </p>
      </header>

      {loading ? <p className="dev-workspace__section-lead">Loading review…</p> : null}

      {error ? (
        <p className="dev-workspace__section-lead" role="alert" data-testid="review-error">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="dev-prelims-review__success" role="status" data-testid="review-success">
          {success}
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
            {!draftPeriod ? (
              <p className="dev-prelims-review__warn" role="status" data-testid="period-not-draft">
                Adoption is unavailable because the open CVR period is no longer Draft.
              </p>
            ) : null}
          </div>

          <div className="dev-prelims-review__actions" data-testid="adoption-action-bar">
            <div className="dev-prelims-review__actions-meta">
              <span data-testid="selected-count">
                {selectedKeys.size} selected
              </span>
              <button
                type="button"
                className="btn"
                onClick={selectAllEligible}
                disabled={!draftPeriod || !eligibleRows.length || adopting}
                data-testid="select-all-eligible"
              >
                Select all eligible
              </button>
            </div>
            <button
              type="button"
              className="po-btn-primary"
              onClick={openConfirm}
              disabled={!draftPeriod || selectedKeys.size === 0 || adopting}
              data-testid="adopt-selected"
            >
              Adopt selected into CVR
            </button>
          </div>

          <div className="dev-prelims-review__list">
            <h4>Cost-code review</h4>
            {candidates.map((row) => {
              const selectable = isSelectableCandidate(row, preview);
              return (
                <CostCodeReviewCard
                  key={row.costCodeKey}
                  row={row}
                  selectable={selectable}
                  selected={selectedKeys.has(row.costCodeKey)}
                  onToggle={toggleKey}
                  disabled={adopting || !draftPeriod}
                />
              );
            })}
          </div>

          {missingRows.length ? (
            <div className="dev-prelims-review__missing" data-testid="missing-from-cvr">
              <h4>Not on current CVR</h4>
              {missingRows.map((row) => (
                <MissingCvrCard
                  key={row.costCodeKey}
                  row={row}
                  canAdd={canAddMissingToCvr(row, preview)}
                  adding={addingKey === row.costCodeKey}
                  disabled={Boolean(addingKey) || adopting}
                  onAdd={handleAddToCvr}
                />
              ))}
            </div>
          ) : null}

          <AdoptionConfirmDialog
            open={confirmOpen}
            rows={selectedRows}
            periodKey={preview.periodKey}
            acknowledgeUnresolved={acknowledgeUnresolved}
            acknowledgeSuperseded={acknowledgeSuperseded}
            onAcknowledgeUnresolved={setAcknowledgeUnresolved}
            onAcknowledgeSuperseded={setAcknowledgeSuperseded}
            needsUnresolvedAck={needsUnresolvedAck}
            needsSupersededAck={needsSupersededAck}
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

export {
  headlineForCandidate,
  signedMoney,
  isSelectableCandidate,
  buildSelectionPayload,
};
