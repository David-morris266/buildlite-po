import { useEffect, useMemo, useRef, useState, memo } from 'react';
import ApplicationPageHeader from './layout/ApplicationPageHeader';
import CvrReportingMonthDialog from './CvrReportingMonthDialog';
import { listPOs } from '../api';
import { subscribeCommercialChanged } from '../commercial/commercialEvents';
import { buildCvrSummaryModel } from '../cvr/cvrSummaryHelpers';
import { formatSignedMovement } from '../cvr/cvrPeriodMovement';
import {
  approveCvrPeriod,
  createNextCvrPeriod,
  getCvrPeriod,
  rejectCvrPeriod,
  saveCvrPeriodCommentary,
  submitCvrPeriod,
} from '../cvr/cvrPeriodStore';
import { resolveCreateNextReportingMonthAction } from '../cvr/cvrCreateNextReportingMonth';
import {
  CVR_HISTORIC_SNAPSHOT_BANNER,
  CVR_HISTORIC_UNAVAILABLE_MESSAGE,
} from '../cvr/cvrHistoricConstants';
import { isCvrServerAuthorityEnabled } from '../cvr/cvrPeriodAuthority';
import {
  ensureCvrPeriodAndInputsReady,
  getCvrPeriodReadiness,
  refreshCvrPeriodsForDevelopment,
} from '../cvr/cvrPeriodServerCache';
import { isLedgerServerAuthorityEnabled } from '../ledger/ledgerAuthority';
import {
  ensureLedgerReadyForDevelopment,
  getLedgerReadiness,
} from '../ledger/ledgerServerCache';
import { isRevenueServerAuthorityEnabled } from '../revenue/revenueAuthority';
import { ensureRevenueSettingsReady } from '../revenue/revenueSettingsServerCache';

function StatusBadge({ status }) {
  if (!status) return '—';
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

const CORE_KPI_ORDER = [
  'forecastCost',
  'forecastProfit',
  'forecastMargin',
  'costToComplete',
  'forecastVariance',
];
const REVENUE_KPI_ORDER = ['forecastRevenue', 'securedRevenue', 'remainingForecast'];

function orderedKpis(items, keys) {
  const byKey = new Map(items.map((item) => [item.key, item]));
  return keys.map((key) => byKey.get(key)).filter(Boolean);
}

export function SummaryKpiRibbon({ items }) {
  const coreItems = orderedKpis(items, CORE_KPI_ORDER);
  const revenueItems = orderedKpis(items, REVENUE_KPI_ORDER);

  return (
    <section className="cvr-summary__kpi-zone" aria-label="Executive KPIs">
      <div className="cvr-summary__kpi-group cvr-summary__kpi-group--core" aria-label="Core commercial position">
        <span className="cvr-summary__kpi-group-label">Core commercial position</span>
        <div className="cvr-summary__kpi-grid cvr-summary__kpi-grid--core">
        {coreItems.map((item) => (
          <div
            key={item.key}
            className={`cvr-summary__kpi cvr-summary__kpi--hero cvr-summary__kpi--${item.modifier}`}
          >
            <span className="cvr-summary__kpi-label">{item.label}</span>
            <strong className="cvr-summary__kpi-value">{item.value}</strong>
            {item.movement ? (
              <span className="cvr-summary__kpi-movement">{item.movement}</span>
            ) : null}
            {item.hint ? (
              <span className="cvr-summary__kpi-hint">{item.hint}</span>
            ) : null}
          </div>
        ))}
        </div>
      </div>
      {revenueItems.length ? (
        <div className="cvr-summary__kpi-group cvr-summary__kpi-group--revenue" aria-label="Revenue context">
          <span className="cvr-summary__kpi-group-label">Revenue context</span>
          <div className="cvr-summary__kpi-grid cvr-summary__kpi-grid--revenue">
          {revenueItems.map((item) => (
            <div
              key={item.key}
              className={`cvr-summary__kpi cvr-summary__kpi--future cvr-summary__kpi--${item.modifier}`}
            >
              <span className="cvr-summary__kpi-label">{item.label}</span>
              <strong className="cvr-summary__kpi-value">{item.value}</strong>
              {item.movement ? (
                <span className="cvr-summary__kpi-movement">{item.movement}</span>
              ) : null}
              {item.hint ? (
                <span className="cvr-summary__kpi-hint">{item.hint}</span>
              ) : null}
            </div>
          ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SummaryPanel({ title, children, className = '' }) {
  return (
    <section className={`cvr-summary__panel po-module-card${className ? ` ${className}` : ''}`}>
      <h2 className="cvr-summary__panel-title">{title}</h2>
      {children}
    </section>
  );
}

function EmptyState({ message }) {
  return <p className="cvr-summary__empty">{message}</p>;
}

export function CommercialCostSummaryTable({ summary, onOpen }) {
  if (!summary.available) return <EmptyState message={summary.emptyMessage} />;
  return (
    <div className="po-table-wrap">
      <table className="po-data-table cvr-summary__table cvr-summary__cost-summary-table">
        <colgroup><col className="cvr-summary__cost-head-column" /><col className="cvr-summary__cost-value-column" /><col className="cvr-summary__cost-value-column" /><col className="cvr-summary__cost-value-column" /><col className="cvr-summary__cost-movement-column" /><col className="cvr-summary__cost-variance-column" /></colgroup>
        <thead><tr><th>Commercial Head</th><th className="cvr-summary__numeric">Current Budget</th><th className="cvr-summary__numeric">Previous CVR</th><th className="cvr-summary__numeric">Current CVR</th><th className="cvr-summary__numeric">Movement</th><th className="cvr-summary__numeric">Variance to Budget</th></tr></thead>
        <tbody>{summary.items.map((item) => <tr key={item.headKey}><td><button type="button" className="cvr-summary__family-link" onClick={() => onOpen?.(item.filter)}>{item.head}</button>{item.hierarchyChanged ? <small className="cvr-summary__hierarchy-change">Hierarchy changed</small> : null}</td><td className="cvr-summary__numeric">{item.budgetLabel}</td><td className="cvr-summary__numeric">{item.previousForecastLabel}</td><td className="cvr-summary__numeric">{item.currentForecastLabel}</td><td className={`cvr-summary__numeric cvr-movement--${item.movementState}`}><strong>{item.movementLabel}</strong></td><td className={`cvr-summary__numeric dev-cvr__variance dev-cvr__variance--${item.varianceState}`}>{item.varianceLabel}</td></tr>)}</tbody>
        <tfoot><tr className="cvr-summary__cost-summary-total"><td><strong>Total</strong></td><td className="cvr-summary__numeric"><strong>{summary.totals.budgetLabel}</strong></td><td className="cvr-summary__numeric"><strong>{summary.totals.previousForecastLabel}</strong></td><td className="cvr-summary__numeric"><strong>{summary.totals.currentForecastLabel}</strong></td><td className={`cvr-summary__numeric cvr-movement--${summary.totals.movementState}`}><strong>{summary.totals.movementLabel}</strong></td><td className={`cvr-summary__numeric dev-cvr__variance dev-cvr__variance--${summary.totals.varianceState}`}><strong>{summary.totals.varianceLabel}</strong></td></tr></tfoot>
      </table>
      <p className="cvr-summary__hint">Select a Commercial Head or hierarchy status to view its Cost Codes in the CVR Worksheet.</p>
    </div>
  );
}

function ResidualExplanation({ row, component, readOnly, onSave }) {
  const [reason, setReason] = useState(component.explanation?.stale ? '' : component.explanation?.reason || '');
  if (!component.unattributed) return null;
  if (component.explanation && !component.explanation.stale) {
    return <p><strong>QS explanation:</strong> {component.explanation.reason} <small>— {component.explanation.actor || 'authorised user'}</small></p>;
  }
  return <div className="cvr-movement__explanation">
    <p><strong>Commercial reason not yet attributed:</strong> {formatSignedMovement(component.unattributed)}</p>
    {component.explanation?.stale ? <p className="cvr-summary__hint">The saved explanation is stale because the underlying movement changed.</p> : null}
    {!readOnly ? <><textarea className="input" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the whole residual movement" />
      <button type="button" className="po-list-btn-secondary" disabled={!reason.trim()} onClick={() => onSave?.(row, component, reason.trim())}>Save explanation</button></> : null}
  </div>;
}

function MovementRows({ title, rows, onOpen, onOpenVariationAccount, readOnly, onSaveExplanation }) {
  if (!rows.length) return null;
  return (
    <section className="cvr-movement__section" aria-label={title}>
      <h3>{title}</h3>
      <div className="po-table-wrap">
        <table className="po-data-table cvr-summary__table cvr-movement__table">
          <thead><tr><th>Cost Code</th><th>Description</th><th>Previous CVR</th><th>Current CVR</th><th>Movement</th><th>Current Budget</th><th>Variance to Budget</th><th>Movement detail</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.id}>
              <td><button type="button" className="dev-cvr__row-link" onClick={(event) => onOpen?.(row, event.currentTarget)}>{row.costCodeLabel}</button></td>
              <td>{row.description || '—'}</td><td>{row.previousForecastLabel}</td><td>{row.currentForecastLabel}</td>
              <td className={row.movement > 0 ? 'cvr-movement--adverse' : row.movement < 0 ? 'cvr-movement--favourable' : ''}><strong>{row.movementLabel}</strong></td>
              <td>{row.currentBudgetLabel}</td><td>{row.varianceLabel}</td>
              <td>
                <details>
                  <summary>{row.unexplained ? `Unreconciled ${row.residualLabel}` : 'Component reconciled'}</summary>
                  <dl className="cvr-movement__bridge">
                    {row.components.map((component) => <div key={component.key}><dt>{component.label}</dt><dd>{component.movementLabel}</dd></div>)}
                    <div><dt>Reconciled movement</dt><dd>{row.explainedLabel}</dd></div><div><dt>Unreconciled</dt><dd>{row.residualLabel}</dd></div>
                  </dl>
                  <h4>Commercial attribution</h4>
                  {row.components.flatMap((component) => component.attributions || []).map((item) => <p key={`${item.sourceType}-${item.sourceId}`}><strong>{item.reference}:</strong> {item.description} {formatSignedMovement(item.amount)} {item.drillThrough?.type === 'variation_account' ? <button type="button" className="cvr-summary__link-btn" onClick={() => onOpenVariationAccount?.({ id: item.drillThrough.id, reference: item.reference })}>Open Variation Account item</button> : null}</p>)}
                  {row.components.map((component) => <ResidualExplanation key={component.key} row={row} component={component} readOnly={readOnly} onSave={onSaveExplanation} />)}
                  {row.supportingActivity?.length ? <><h4>Supporting activity only</h4>{row.supportingActivity.map((item) => <p key={item.sourceType}>{item.description}: {formatSignedMovement(item.amountPence / 100)}</p>)}</> : null}
                  {row.adjustmentReason ? <p>Commercial Adjustment: {row.adjustmentReason}</p> : null}
                  {row.hierarchyChanged ? <p>Hierarchy changed: {row.previousHierarchy.label} → {row.currentHierarchy.label}</p> : null}
                </details>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

export function CvrMovementReport({ report, onOpen, onOpenVariationAccount, readOnly = true, onSaveExplanation }) {
  if (!report?.available) return <EmptyState message="Period movement will be available after the first CVR is Locked and the next period is created." />;
  return (
    <div className="cvr-movement" aria-label="CVR Movement Report">
      <p><strong>Total movement:</strong> {formatSignedMovement(report.totalMovement)} · <strong>Automatically attributed:</strong> {formatSignedMovement(report.automaticallyAttributed)} · <strong>QS explained:</strong> {formatSignedMovement(report.qsExplained)} · <strong>Awaiting explanation:</strong> {formatSignedMovement(report.awaitingExplanation)}</p>
      <MovementRows title="Key adverse movements" rows={report.sections.adverse} onOpen={onOpen} onOpenVariationAccount={onOpenVariationAccount} readOnly={readOnly} onSaveExplanation={onSaveExplanation} />
      <MovementRows title="Key favourable movements" rows={report.sections.favourable} onOpen={onOpen} onOpenVariationAccount={onOpenVariationAccount} readOnly={readOnly} onSaveExplanation={onSaveExplanation} />
      <MovementRows title="Other movements" rows={report.sections.other} onOpen={onOpen} onOpenVariationAccount={onOpenVariationAccount} readOnly={readOnly} onSaveExplanation={onSaveExplanation} />
      <MovementRows title="Unreconciled movements requiring review" rows={report.sections.unexplained} onOpen={onOpen} onOpenVariationAccount={onOpenVariationAccount} readOnly={readOnly} onSaveExplanation={onSaveExplanation} />
      {!report.sections.adverse.length && !report.sections.favourable.length && !report.sections.other.length && !report.sections.unexplained.length
        ? <p className="cvr-summary__empty">No Final Forecast movement this period.</p>
        : null}
    </div>
  );
}

export function CvrMovementInspection({ row, onClose, onOpenWorksheet, onOpenVariationAccount }) {
  const inspectionRef = useRef(null);
  useEffect(() => inspectionRef.current?.focus(), []);
  if (!row) return null;
  const attributions = row.components.flatMap((component) => component.attributions || []);
  const hasAdjustmentAttribution = attributions.some((item) => item.sourceType === 'commercial_adjustment' || item.reference === 'Commercial Adjustment');
  return <section ref={inspectionRef} tabIndex={-1} className="cvr-movement-inspection" role="region" aria-label={`Movement inspection for ${row.costCodeLabel}`}>
    <div className="cvr-movement-inspection__header"><div><span>Cost Code movement</span><h3>{row.costCodeLabel}{row.description ? ` — ${row.description}` : ''}</h3></div><button type="button" className="po-list-btn-secondary" onClick={onClose}>Close</button></div>
    <dl className="cvr-movement-inspection__position"><div><dt>Previous CVR</dt><dd>{row.previousForecastLabel}</dd></div><div><dt>Current CVR</dt><dd>{row.currentForecastLabel}</dd></div><div><dt>Movement</dt><dd className={row.movement > 0 ? 'cvr-movement--adverse' : row.movement < 0 ? 'cvr-movement--favourable' : ''}>{row.movementLabel}</dd></div></dl>
    <div className="po-table-wrap"><table className="po-data-table cvr-movement-inspection__bridge"><colgroup><col className="cvr-movement-inspection__component-column" /><col className="cvr-movement-inspection__numeric-column" /><col className="cvr-movement-inspection__numeric-column" /><col className="cvr-movement-inspection__numeric-column" /></colgroup><thead><tr><th>Component</th><th className="cvr-summary__numeric">Previous</th><th className="cvr-summary__numeric">Current</th><th className="cvr-summary__numeric">Movement</th></tr></thead><tbody>{row.components.map((component) => <tr key={component.key}><td>{component.label}</td><td className="cvr-summary__numeric">{component.previousLabel || '—'}</td><td className="cvr-summary__numeric">{component.currentLabel || '—'}</td><td className="cvr-summary__numeric">{component.movementLabel}</td></tr>)}<tr><th>Final Forecast</th><td className="cvr-summary__numeric">{row.previousForecastLabel}</td><td className="cvr-summary__numeric">{row.currentForecastLabel}</td><td className="cvr-summary__numeric">{row.movementLabel}</td></tr></tbody></table></div>
    <div className="cvr-movement-inspection__evidence"><h4>Commercial attribution</h4>{attributions.map((item) => <p key={`${item.sourceType}-${item.sourceId}`}><strong>{item.reference}:</strong> {item.description} {formatSignedMovement(item.amount)} {item.drillThrough?.type === 'variation_account' ? <button type="button" className="cvr-summary__link-btn" onClick={() => onOpenVariationAccount?.({ id: item.drillThrough.id, reference: item.reference })}>Open Variation Account item</button> : null}</p>)}{row.components.map((component) => component.explanation ? <p key={`${component.key}-explanation`}><strong>{component.explanation.stale ? 'Stale QS explanation' : 'QS explanation'}:</strong> {component.explanation.reason}</p> : component.requiresExplanation ? <p key={`${component.key}-awaiting`}><strong>Awaiting QS explanation:</strong> {component.movementLabel}</p> : null)}{row.adjustmentReason && !hasAdjustmentAttribution ? <p><strong>Commercial Adjustment:</strong> {row.adjustmentReason}</p> : null}<p><strong>Reconciled movement:</strong> {row.explainedLabel} · <strong>Unreconciled:</strong> {row.residualLabel}</p></div>
    <button type="button" className="po-btn-primary" onClick={() => onOpenWorksheet?.(row.costCodeKey)}>Open in CVR Worksheet</button>
  </section>;
}

export function RevenueMovementTable({ executive }) {
  const rows = [
    ['Forecast Revenue', executive.labels.previousForecastRevenue, executive.labels.forecastRevenue, executive.labels.revenueMovement],
    ['Gross Profit', executive.labels.previousGrossProfit, executive.labels.grossProfit, executive.labels.profitMovement],
    ['Gross Margin', executive.labels.previousGrossMargin, executive.labels.grossMargin, executive.labels.marginMovement],
  ];
  return <div className="po-table-wrap"><table className="po-data-table cvr-summary__table cvr-summary__revenue-movement"><colgroup><col className="cvr-summary__revenue-metric-column" /><col className="cvr-summary__revenue-value-column" /><col className="cvr-summary__revenue-value-column" /><col className="cvr-summary__revenue-value-column" /></colgroup><thead><tr><th>Metric</th><th className="cvr-summary__numeric">Previous CVR</th><th className="cvr-summary__numeric">Current</th><th className="cvr-summary__numeric">Movement</th></tr></thead><tbody>{rows.map(([label, previous, current, movement]) => <tr key={label}><td>{label}</td><td className="cvr-summary__numeric">{previous}</td><td className="cvr-summary__numeric">{current}</td><td className="cvr-summary__numeric">{movement}</td></tr>)}</tbody></table></div>;
}

function RejectDialog({ open, onCancel, onConfirm }) {
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!open) setComment('');
  }, [open]);

  if (!open) return null;

  return (
    <div className="dev-cvr-add-backdrop" role="presentation">
      <div className="dev-cvr-add modal" role="dialog" aria-modal="true">
        <h3>Reject CVR</h3>
        <p className="dev-cvr-add__lead">
          A comment is required when returning a submitted CVR to draft.
        </p>
        <textarea
          className="input"
          rows={4}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Explain what must be revised before resubmission."
        />
        <div className="dev-cvr-add__actions modal-actions">
          <button type="button" className="po-list-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="po-btn-primary"
            onClick={() => onConfirm(comment)}
            disabled={!String(comment || '').trim()}
          >
            Reject to Draft
          </button>
        </div>
      </div>
    </div>
  );
}

const MemoSummaryKpiRibbon = memo(SummaryKpiRibbon);

export default function CVRSummaryPage({
  development,
  periodKey,
  refreshToken = 0,
  pageNavigation = null,
  onContinueToCvr,
  onOpenWorksheetForHierarchy,
  onOpenWorksheetForCostCode,
  onBackToRegister,
  onPeriodChanged,
  onOpenVariationAccount,
  initialCostCodeKey = null,
  certificatesLoading = false,
  certificatesReady = true,
  certificatesError = '',
}) {
  const [pos, setPos] = useState([]);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [selectedRow, setSelectedRow] = useState(null);
  const [selectedMovement, setSelectedMovement] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reportingMonthPrompt, setReportingMonthPrompt] = useState(null);
  const [reportingMonthBusy, setReportingMonthBusy] = useState(false);
  const movementReportRef = useRef(null);
  const movementOriginRef = useRef(null);
  const [commentary, setCommentary] = useState({
    keyCommercialIssues: '',
    commercialOpportunities: '',
    financialRisks: '',
    actionsBeforeNextCvr: '',
  });

  useEffect(() => {
    let cancelled = false;
    listPOs()
      .then((data) => {
        if (cancelled) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        setPos(items);
      })
      .catch(() => {
        if (!cancelled) setPos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken, localRefresh]);

  useEffect(() => {
    const unsubscribe = subscribeCommercialChanged(() => {
      if (isCvrServerAuthorityEnabled()) {
        refreshCvrPeriodsForDevelopment(development.id)
          .catch(() => null)
          .finally(() => setLocalRefresh((value) => value + 1));
      } else {
        setLocalRefresh((value) => value + 1);
      }
    });
    return unsubscribe;
  }, [development.id]);

  useEffect(() => {
    if (
      !isCvrServerAuthorityEnabled() &&
      !isLedgerServerAuthorityEnabled() &&
      !isRevenueServerAuthorityEnabled()
    ) {
      return undefined;
    }
    let cancelled = false;

    (async () => {
      try {
        if (isCvrServerAuthorityEnabled()) {
          await refreshCvrPeriodsForDevelopment(development.id);
          await ensureCvrPeriodAndInputsReady(development.id, periodKey);
        }
        if (isLedgerServerAuthorityEnabled()) {
          await ensureLedgerReadyForDevelopment(development.id).catch(() => null);
        }
        if (isRevenueServerAuthorityEnabled()) {
          await ensureRevenueSettingsReady(development.id).catch(() => null);
        }
      } catch {
        // Cache error state is authoritative; no localStorage fallback.
      }
      if (!cancelled) setLocalRefresh((value) => value + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [development.id, periodKey, refreshToken]);

  const summary = useMemo(() => {
    void refreshToken;
    void localRefresh;
    void certificatesReady;
    const period = getCvrPeriod(development.id, periodKey);
    return buildCvrSummaryModel(development, { pos, periodKey, period });
  }, [development, pos, periodKey, refreshToken, localRefresh, certificatesReady]);

  useEffect(() => {
    if (!summary) return;
    setCommentary(summary.commentary);
  }, [summary?.commentary, summary?.periodKey]);

  useEffect(() => {
    if (!initialCostCodeKey || !summary?.rows?.length) return;
    const row = summary.rows.find((item) => item.costCodeKey === initialCostCodeKey);
    const movements = summary.movementReport?.sections ? Object.values(summary.movementReport.sections).flat() : [];
    const movement = movements.find((item) => item.costCodeKey === initialCostCodeKey);
    if (row && movement) { setSelectedRow(row); setSelectedMovement(movement); }
  }, [initialCostCodeKey, summary?.rows, summary?.movementReport?.sections]);

  useEffect(() => {
    if (!selectedRow || !summary?.rows?.length) return;
    const latest = summary.rows.find(
      (row) =>
        row.id === selectedRow.id ||
        (row.costCodeKey &&
          selectedRow.costCodeKey &&
          row.costCodeKey === selectedRow.costCodeKey)
    );
    if (latest) setSelectedRow(latest);
    else { setSelectedRow(null); setSelectedMovement(null); }
  }, [selectedRow, summary?.rows]);

  function refresh() {
    setLocalRefresh((value) => value + 1);
    onPeriodChanged?.();
  }

  async function handleSubmit() {
    const result = await Promise.resolve(submitCvrPeriod(development.id, periodKey));
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not submit CVR.');
      return;
    }
    refresh();
  }

  async function handleApprove() {
    const result = await Promise.resolve(approveCvrPeriod(development.id, periodKey));
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not approve CVR.');
      return;
    }
    refresh();
  }

  async function handleReject(comment) {
    const result = await Promise.resolve(rejectCvrPeriod(development.id, periodKey, comment));
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not reject CVR.');
      return;
    }
    setRejectOpen(false);
    refresh();
  }

  async function handleCreateNextPeriod() {
    const action = resolveCreateNextReportingMonthAction(development.id);
    if (action.kind === 'recover') {
      const result = await Promise.resolve(createNextCvrPeriod(development.id));
      if (!result.ok) {
        window.alert(result.errors?.[0] || 'Could not create next CVR period.');
        return;
      }
      refresh();
      onBackToRegister?.();
      return;
    }
    if (action.kind === 'blocked') {
      window.alert(action.reason || 'Could not create next CVR period.');
      return;
    }
    setReportingMonthPrompt(action);
  }

  async function handleConfirmReportingMonth(reportingMonth) {
    setReportingMonthBusy(true);
    try {
      const result = await Promise.resolve(
        createNextCvrPeriod(development.id, { reportingMonth })
      );
      if (!result.ok) {
        window.alert(result.errors?.[0] || 'Could not create next CVR period.');
        return;
      }
      setReportingMonthPrompt(null);
      refresh();
      onBackToRegister?.();
    } finally {
      setReportingMonthBusy(false);
    }
  }

  async function handleCommentaryBlur(field) {
    if (summary.readOnly) return;
    const result = await Promise.resolve(
      saveCvrPeriodCommentary(development.id, periodKey, {
        [field]: commentary[field],
      })
    );
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not save commentary.');
      return;
    }
    refresh();
  }

  async function handleSaveMovementExplanation(row, component, reason) {
    if (summary.readOnly) return;
    const existing = (summary.commentary.movementExplanations || []).filter((item) =>
      !(item.costCodeKey === row.costCodeKey && item.component === component.key));
    const result = await Promise.resolve(saveCvrPeriodCommentary(development.id, periodKey, {
      movementExplanations: [...existing, {
        costCodeKey: row.costCodeKey,
        component: component.key,
        previousPeriodId: summary.movementReport.previousPeriodId,
        previousSnapshotId: summary.movementReport.previousSnapshotId,
        fingerprint: component.fingerprint,
        unexplainedAmount: component.unattributed,
        reason,
      }],
    }));
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not save movement explanation.');
      return;
    }
    refresh();
  }

  function openCostCodeRow(row) {
    onOpenWorksheetForCostCode?.(row.costCodeKey);
    onContinueToCvr?.();
  }

  function openWorksheetForHierarchy(filter) {
    onOpenWorksheetForHierarchy?.(filter);
    onContinueToCvr?.();
  }

  function openMovementRow(row, trigger) {
    const costCodeKey = String(row?.costCodeKey || '').trim();
    const canonicalRow = costCodeKey
      ? summary.rows.find((candidate) => String(candidate.costCodeKey || '').trim() === costCodeKey)
      : null;
    movementOriginRef.current = trigger || null;
    setSelectedRow(canonicalRow || null);
    setSelectedMovement(canonicalRow ? row : null);
  }

  function closeSummaryCostCodeDetail() {
    setSelectedRow(null);
    setSelectedMovement(null);
    queueMicrotask(() => (movementOriginRef.current || movementReportRef.current)?.focus());
  }

  if (!summary) return null;

  const cvrReadiness = isCvrServerAuthorityEnabled()
    ? getCvrPeriodReadiness(development.id)
    : { ready: true, loadState: 'local', error: null };
  const ledgerReadiness = isLedgerServerAuthorityEnabled()
    ? getLedgerReadiness(development.id)
    : { ready: true, loadState: 'local', error: null };
  const cvrError = cvrReadiness.loadState === 'error' || summary.loadState === 'error';
  const ledgerError = ledgerReadiness.loadState === 'error';

  if (summary.unavailable && !summary.historicUnavailable) {
    return (
      <div className="dev-cvr dev-cvr-workspace dev-cvr-workspace--focused cvr-summary">
        <ApplicationPageHeader
          breadcrumbs={pageNavigation?.breadcrumbs || []}
          title={development.developmentName}
          lead={`Development ${development.jobNumber || '—'}`}
          onBack={onBackToRegister}
        />
        {cvrError ? (
          <div className="po-list-feedback po-list-feedback--error" role="alert">
            Unable to load CVR data
          </div>
        ) : (
          <p role="status">Loading CVR data…</p>
        )}
      </div>
    );
  }

  return (
    <div className="dev-cvr dev-cvr-workspace dev-cvr-workspace--focused cvr-summary">
      <ApplicationPageHeader
        breadcrumbs={pageNavigation?.breadcrumbs || []}
        title={summary.header.developmentName}
        lead={`Development ${summary.header.developmentNumber}`}
        onBack={onBackToRegister}
        actions={(
          <>
            {summary.workflow.showContinue ? (
              <button type="button" className="po-btn-primary" onClick={onContinueToCvr}>
                {summary.workflow.continueLabel}
              </button>
            ) : null}
            {summary.workflow.showSubmit ? (
              <button type="button" className="po-list-btn-secondary pilot-lifecycle-action" onClick={handleSubmit}>
                Submit for Approval
              </button>
            ) : null}
            {summary.workflow.showApprove ? (
              <button type="button" className="po-btn-primary" onClick={handleApprove}>
                Approve &amp; Lock
              </button>
            ) : null}
            {summary.workflow.showReject ? (
              <button
                type="button"
                className="po-list-btn-secondary pilot-lifecycle-action"
                onClick={() => setRejectOpen(true)}
              >
                Reject
              </button>
            ) : null}
            {summary.workflow.showCreateNext ? (
              <button type="button" className="po-list-btn-secondary pilot-lifecycle-action" onClick={handleCreateNextPeriod}>
                Create Next Period
              </button>
            ) : null}
          </>
        )}
      >
        <div className="cvr-summary__header-meta">
          <StatusBadge status={summary.status} />
          <dl className="cvr-summary__meta-grid">
            <div>
              <dt>Reporting Period</dt>
              <dd>{summary.header.reportingPeriodLabel}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{summary.header.createdLabel}</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>{summary.header.submittedLabel}</dd>
            </div>
            <div>
              <dt>Approved</dt>
              <dd>{summary.header.approvedLabel}</dd>
            </div>
            <div>
              <dt>Approved By</dt>
              <dd>{summary.header.approvedBy}</dd>
            </div>
            <div>
              <dt>Last Updated</dt>
              <dd>{summary.header.lastUpdatedLabel}</dd>
            </div>
            <div>
              <dt>Commercial Manager</dt>
              <dd>{summary.header.commercialManager}</dd>
            </div>
          </dl>
        </div>
      </ApplicationPageHeader>

      {summary.period?.status === 'submitted' && summary.period?.variationExposure?.stale ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          Variation Account exposure changed after this CVR was submitted. Reject to Draft, review the updated position and resubmit before Lock.
          {summary.period.variationExposure.staleReasons?.length
            ? ` ${summary.period.variationExposure.staleReasons.join(', ')}`
            : ''}
        </div>
      ) : null}

      {summary.historicUnavailable ? (
        <div className="po-list-feedback po-list-feedback--warning" role="status">
          {CVR_HISTORIC_UNAVAILABLE_MESSAGE}
        </div>
      ) : summary.historic ? (
        <div className="po-list-feedback po-list-feedback--info" role="status">
          {CVR_HISTORIC_SNAPSHOT_BANNER}
        </div>
      ) : null}

      {!summary.historic && !summary.historicUnavailable && certificatesError ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          Unable to load certificate data. {certificatesError}
        </div>
      ) : !summary.historic && !summary.historicUnavailable && certificatesLoading ? (
        <p role="status">Loading certificate data…</p>
      ) : null}

      {!summary.historic && !summary.historicUnavailable && ledgerError ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          Unable to load ledger data
        </div>
      ) : !summary.historic &&
        !summary.historicUnavailable &&
        isLedgerServerAuthorityEnabled() &&
        !ledgerReadiness.ready ? (
        <p role="status">Loading ledger data…</p>
      ) : null}

      {!summary.historicUnavailable ? <MemoSummaryKpiRibbon items={summary.kpis} /> : null}

      {!summary.historicUnavailable ? (
      <div className="cvr-summary__grid">
        <SummaryPanel
          title="Commercial Cost Summary"
          className="cvr-summary__panel--wide cvr-summary__panel--centrepiece"
        >
          <CommercialCostSummaryTable summary={summary.commercialCostSummary} onOpen={openWorksheetForHierarchy} />
          <h3 className="cvr-summary__subheading">Revenue and margin movement</h3>
          <RevenueMovementTable executive={summary.movementReport.executive} />
        </SummaryPanel>
        <SummaryPanel title="Movement explanations" className="cvr-summary__panel--wide cvr-summary__panel--centrepiece">
          <div ref={movementReportRef} tabIndex={-1}>
            <CvrMovementReport
              report={summary.movementReport}
              onOpen={openMovementRow}
              onOpenVariationAccount={onOpenVariationAccount}
              readOnly={summary.readOnly}
              onSaveExplanation={handleSaveMovementExplanation}
            />
          </div>
          {selectedRow && selectedMovement ? <CvrMovementInspection row={selectedMovement} onClose={closeSummaryCostCodeDetail} onOpenWorksheet={(costCodeKey) => { onOpenWorksheetForCostCode?.(costCodeKey); onContinueToCvr?.(); }} onOpenVariationAccount={onOpenVariationAccount} /> : null}
        </SummaryPanel>

        <SummaryPanel title="Financial Position" className="cvr-summary__panel--wide cvr-summary__panel--supporting">
          <div className="cvr-summary__metric-grid cvr-summary__metric-grid--compact">
            {summary.financialPosition.map((item) => (
              <div
                key={item.key}
                className={`cvr-summary__metric cvr-summary__metric--${item.modifier || 'default'}`}
              >
                <span className="cvr-summary__metric-label">{item.label}</span>
                <strong className="cvr-summary__metric-value">{item.valueLabel}</strong>
                {item.proportionLabel ? (
                  <span className="cvr-summary__metric-proportion">{item.proportionLabel} of forecast</span>
                ) : null}
              </div>
            ))}
          </div>
        </SummaryPanel>

        <SummaryPanel title="Commercial Exceptions" className="cvr-summary__panel--featured">
          <ul className="cvr-summary__exception-list">
            {summary.commercialExceptions.map((item) => (
              <li key={item.key} className="cvr-summary__exception-item">
                <div className="cvr-summary__exception-head">
                  <strong>{item.label}</strong>
                  <span>
                    {item.count} · {item.valueLabel}
                  </span>
                </div>
                {!item.unavailable && item.rows?.length ? (
                  <div className="cvr-summary__exception-links">
                    {item.rows.slice(0, 3).map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        className="cvr-summary__link-btn"
                        onClick={() => openCostCodeRow(row)}
                      >
                        {row.costCodeLabel}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </SummaryPanel>

        <SummaryPanel title="Top Cost Variances" className="cvr-summary__panel--featured">
          {summary.topVariances.length ? (
            <div className="po-table-wrap">
              <table className="po-data-table cvr-summary__table">
                <thead>
                  <tr>
                    <th>Cost Code</th>
                    <th>Description</th>
                    <th style={{ textAlign: 'right' }}>Budget</th>
                    <th style={{ textAlign: 'right' }}>Final Forecast</th>
                    <th style={{ textAlign: 'right' }}>Variance</th>
                    <th style={{ textAlign: 'right' }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.topVariances.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <button
                          type="button"
                          className="dev-cvr__row-link"
                          onClick={() => openCostCodeRow(row)}
                        >
                          {row.costCodeLabel}
                        </button>
                      </td>
                      <td>{row.description}</td>
                      <td style={{ textAlign: 'right' }}>{row.currentBudgetLabel}</td>
                      <td style={{ textAlign: 'right' }}>{row.finalForecastLabel}</td>
                      <td
                        style={{ textAlign: 'right' }}
                        className={`dev-cvr__variance dev-cvr__variance--${row.varianceState}`}
                      >
                        {row.varianceLabel}
                      </td>
                      <td style={{ textAlign: 'right' }}>{row.variancePercentLabel || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No cost code variances recorded for this period." />
          )}
        </SummaryPanel>

        <SummaryPanel title="Development Summary" className="cvr-summary__panel--compact">
          <dl className="cvr-summary__facts-grid cvr-summary__facts-grid--compact">
            <div>
              <dt>Plots</dt>
              <dd>
                {summary.developmentSummary.activePlots || '—'} active /{' '}
                {summary.developmentSummary.totalPlots || '—'} total
              </dd>
            </div>
            <div>
              <dt>Plots Sold</dt>
              <dd>{summary.developmentSummary.plotsSoldLabel}</dd>
            </div>
            <div>
              <dt>Configurations</dt>
              <dd>{summary.developmentSummary.configurationLabel}</dd>
            </div>
            <div>
              <dt>Purchase Orders</dt>
              <dd>{summary.developmentSummary.purchaseOrderCount || '—'}</dd>
            </div>
            <div>
              <dt>Certificates</dt>
              <dd>{summary.developmentSummary.certificateCount || '—'}</dd>
            </div>
          </dl>
          {summary.developmentSummary.emptySalesHint ? (
            <p className="cvr-summary__hint">{summary.developmentSummary.emptySalesHint}</p>
          ) : null}
        </SummaryPanel>

        {summary.historicRevenuePlots?.available ? (
          <SummaryPanel
            title="Historic plot revenue"
            className="cvr-summary__panel--wide cvr-summary__panel--supporting"
          >
            {summary.historicRevenuePlots.rows.length ? (
              <div className="po-table-wrap">
                <table className="po-data-table cvr-summary__table">
                  <thead>
                    <tr>
                      <th>Plot</th>
                      <th>House Type</th>
                      <th>Tenure / category</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Forecast Revenue</th>
                      <th style={{ textAlign: 'right' }}>Secured Revenue</th>
                      <th style={{ textAlign: 'right' }}>Remaining Forecast</th>
                      <th style={{ textAlign: 'right' }}>Selling Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.historicRevenuePlots.rows.map((row) => (
                      <tr key={row.plotId || row.plotNumber}>
                        <td>{row.plotNumber || '—'}</td>
                        <td>{row.houseType || '—'}</td>
                        <td>{row.category || '—'}</td>
                        <td>{row.revenueStatus || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{row.forecastRevenueLabel}</td>
                        <td style={{ textAlign: 'right' }}>{row.securedRevenueLabel}</td>
                        <td style={{ textAlign: 'right' }}>{row.remainingForecastRevenueLabel}</td>
                        <td style={{ textAlign: 'right' }}>{row.sellingPriceLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState message={summary.historicRevenuePlots.emptyMessage} />
            )}
            <p className="cvr-summary__hint">
              Frozen plot revenue from this CVR snapshot. Read-only historic evidence.
            </p>
          </SummaryPanel>
        ) : null}

        <SummaryPanel title="Commercial Commentary" className="cvr-summary__panel--wide">
          <div className="cvr-summary__commentary-grid">
            {[
              ['keyCommercialIssues', 'Key Commercial Issues'],
              ['commercialOpportunities', 'Commercial Opportunities'],
              ['financialRisks', 'Financial Risks'],
              ['actionsBeforeNextCvr', 'Actions Before Next CVR'],
            ].map(([field, label]) => (
              <label key={field} className="dev-form__field">
                <span className="dev-form__label">{label}</span>
                <textarea
                  className="input cvr-summary__commentary-input"
                  rows={3}
                  value={commentary[field]}
                  readOnly={summary.readOnly}
                  onChange={(event) =>
                    setCommentary((prev) => ({ ...prev, [field]: event.target.value }))
                  }
                  onBlur={() => handleCommentaryBlur(field)}
                  placeholder={
                    summary.readOnly
                      ? 'Read-only for submitted or locked periods.'
                      : `Record ${label.toLowerCase()} for this CVR period.`
                  }
                />
              </label>
            ))}
          </div>
        </SummaryPanel>

        <SummaryPanel title="Recent Commercial Activity" className="cvr-summary__panel--wide">
          {summary.recentActivity.length ? (
            <ul className="cvr-summary__activity-list">
              {summary.recentActivity.map((item) => (
                <li key={item.id}>
                  <strong>{item.label}</strong>
                  <span>{item.dateTimeLabel}</span>
                  <span>{item.actor}</span>
                  {item.description ? <p>{item.description}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="No commercial activity recorded yet for this period." />
          )}
        </SummaryPanel>
      </div>
      ) : null}

      <RejectDialog
        open={rejectOpen}
        onCancel={() => setRejectOpen(false)}
        onConfirm={handleReject}
      />
      <CvrReportingMonthDialog
        open={Boolean(reportingMonthPrompt)}
        nextPeriodKey={reportingMonthPrompt?.nextPeriodKey || ''}
        suggestedMonth={reportingMonthPrompt?.suggestedMonth || ''}
        busy={reportingMonthBusy}
        onCancel={() => {
          if (reportingMonthBusy) return;
          setReportingMonthPrompt(null);
        }}
        onConfirm={handleConfirmReportingMonth}
      />
    </div>
  );
}
