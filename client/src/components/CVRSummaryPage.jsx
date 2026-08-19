import { useEffect, useMemo, useState, memo } from 'react';
import ApplicationPageHeader from './layout/ApplicationPageHeader';
import { listPOs } from '../api';
import { subscribeCommercialChanged } from '../commercial/commercialEvents';
import { buildCvrSummaryModel } from '../cvr/cvrSummaryHelpers';
import {
  approveCvrPeriod,
  createNextCvrPeriod,
  getCvrPeriod,
  rejectCvrPeriod,
  saveCvrPeriodCommentary,
  submitCvrPeriod,
} from '../cvr/cvrPeriodStore';
import {
  updateCostCentre,
  upsertAutoCostCentre,
} from '../cvr/costCentreStore';
import CostCentreDrawer from './CostCentreDrawer';
import { applyCostCentreSaveToCvrRow } from '../cvr/cvrForecastEngine';
import {
  buildCertificatesForCostCentre,
  buildLedgerRowsForCostCentre,
  buildPackagesForCostCentre,
} from '../cvr/cvrEngine';
import { isCvrServerAuthorityEnabled } from '../cvr/cvrPeriodAuthority';
import {
  ensureCvrPeriodAndInputsReady,
  getCvrPeriodReadiness,
} from '../cvr/cvrPeriodServerCache';
import { isLedgerServerAuthorityEnabled } from '../ledger/ledgerAuthority';
import {
  ensureLedgerReadyForDevelopment,
  getLedgerReadiness,
} from '../ledger/ledgerServerCache';

function StatusBadge({ status }) {
  if (!status) return '—';
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

function SummaryKpiRibbon({ items }) {
  const heroItems = items.filter((item) => item.emphasis === 'hero');
  const futureItems = items.filter((item) => item.emphasis === 'future');

  return (
    <section className="cvr-summary__kpi-zone" aria-label="Executive KPIs">
      <div className="cvr-summary__kpi-hero" aria-label="Primary commercial KPIs">
        {heroItems.map((item) => (
          <div
            key={item.key}
            className={`cvr-summary__kpi cvr-summary__kpi--hero cvr-summary__kpi--${item.modifier}`}
          >
            <span className="cvr-summary__kpi-label">{item.label}</span>
            <strong className="cvr-summary__kpi-value">{item.value}</strong>
            {item.movement ? (
              <span className="cvr-summary__kpi-movement">{item.movement}</span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="cvr-summary__kpi-future" aria-label="Future revenue KPIs">
        {futureItems.map((item) => (
          <div
            key={item.key}
            className={`cvr-summary__kpi cvr-summary__kpi--future cvr-summary__kpi--${item.modifier}`}
          >
            <span className="cvr-summary__kpi-label">{item.label}</span>
            <strong className="cvr-summary__kpi-value">{item.value}</strong>
            {item.hint ? (
              <span className="cvr-summary__kpi-hint">{item.hint}</span>
            ) : null}
          </div>
        ))}
      </div>
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
  onOpenWorksheetForHead,
  onOpenWorksheetForFamily,
  onBackToRegister,
  onOpenPackage,
  onPeriodChanged,
  initialCostCodeKey = null,
  certificatesLoading = false,
  certificatesReady = true,
  certificatesError = '',
}) {
  const [pos, setPos] = useState([]);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [selectedRow, setSelectedRow] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
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
      setLocalRefresh((value) => value + 1);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isCvrServerAuthorityEnabled() && !isLedgerServerAuthorityEnabled()) return undefined;
    let cancelled = false;

    (async () => {
      try {
        if (isCvrServerAuthorityEnabled()) {
          await ensureCvrPeriodAndInputsReady(development.id, periodKey);
        }
        if (isLedgerServerAuthorityEnabled()) {
          await ensureLedgerReadyForDevelopment(development.id).catch(() => null);
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
    if (row) setSelectedRow(row);
  }, [initialCostCodeKey, summary?.rows]);

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
  }, [summary?.rows]);

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
    const result = await Promise.resolve(createNextCvrPeriod(development.id));
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not create next CVR period.');
      return;
    }
    refresh();
    onBackToRegister?.();
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

  function openCostCodeRow(row) {
    setSelectedRow(row);
  }

  function openWorksheetForHead(head) {
    onOpenWorksheetForHead?.(head);
    onOpenWorksheetForFamily?.(head);
    onContinueToCvr?.();
  }

  async function resolveCentreId(row) {
    let targetId = row.id.startsWith('auto-') ? null : row.id;
    if (!targetId) {
      const created = await Promise.resolve(
        upsertAutoCostCentre(
          development.id,
          {
            costCodeKey: row.costCodeKey,
            costCodeLabel: row.costCodeLabel,
          },
          periodKey
        )
      );
      targetId = created?.id;
    }
    return targetId;
  }

  async function handleSaveCommercialAdjustment(values) {
    if (summary.readOnly || !selectedRow) {
      return { ok: false, errors: ['This CVR period is read-only.'] };
    }

    const centreId = await resolveCentreId(selectedRow);
    if (!centreId) return { ok: false, errors: ['Could not resolve cost code.'] };

    const result = await Promise.resolve(
      updateCostCentre(development.id, centreId, values, periodKey)
    );
    if (!result.ok) return result;

    setSelectedRow((prev) =>
      prev ? applyCostCentreSaveToCvrRow(prev, result.costCentre) : prev
    );
    refresh();
    return result;
  }

  async function handleSaveNotes(patch) {
    if (summary.readOnly || !selectedRow) return;

    const targetId = await resolveCentreId(selectedRow);
    if (!targetId) return;

    const result = await Promise.resolve(
      updateCostCentre(development.id, targetId, patch, periodKey)
    );
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not save cost-code notes.');
      return result;
    }
    setSelectedRow((prev) =>
      prev ? applyCostCentreSaveToCvrRow(prev, result.costCentre || patch) : prev
    );
    refresh();
    return result;
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

  if (summary.unavailable) {
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

  const drawerPackages = selectedRow
    ? buildPackagesForCostCentre(development.id, selectedRow.costCodeKey, pos)
    : [];
  const drawerLedgerRows = selectedRow
    ? buildLedgerRowsForCostCentre(development.id, selectedRow.costCodeKey)
    : [];
  const drawerCertificates = selectedRow
    ? buildCertificatesForCostCentre(development.id, selectedRow.costCodeKey, pos)
    : [];

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
              <button type="button" className="po-list-btn-secondary" onClick={handleSubmit}>
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
                className="po-list-btn-secondary"
                onClick={() => setRejectOpen(true)}
              >
                Reject
              </button>
            ) : null}
            {summary.workflow.showCreateNext ? (
              <button type="button" className="po-list-btn-secondary" onClick={handleCreateNextPeriod}>
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

      {certificatesError ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          Unable to load certificate data. {certificatesError}
        </div>
      ) : certificatesLoading ? (
        <p role="status">Loading certificate data…</p>
      ) : null}

      {ledgerError ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          Unable to load ledger data
        </div>
      ) : isLedgerServerAuthorityEnabled() && !ledgerReadiness.ready ? (
        <p role="status">Loading ledger data…</p>
      ) : null}

      <MemoSummaryKpiRibbon items={summary.kpis} />

      <div className="cvr-summary__grid">
        <SummaryPanel
          title="Commercial Cost Summary"
          className="cvr-summary__panel--wide cvr-summary__panel--centrepiece"
        >
          {summary.commercialCostSummary.available ? (
            <div className="po-table-wrap">
              <table className="po-data-table cvr-summary__table cvr-summary__cost-summary-table">
                <thead>
                  <tr>
                    <th>Commercial Head</th>
                    <th style={{ textAlign: 'right' }}>Budget</th>
                    <th style={{ textAlign: 'right' }}>Final Forecast</th>
                    <th style={{ textAlign: 'right' }}>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.commercialCostSummary.items.map((item) => (
                    <tr key={item.head}>
                      <td>
                        <button
                          type="button"
                          className="cvr-summary__family-link"
                          onClick={() => openWorksheetForHead(item.head)}
                        >
                          {item.head}
                        </button>
                      </td>
                      <td style={{ textAlign: 'right' }}>{item.budgetLabel}</td>
                      <td style={{ textAlign: 'right' }}>{item.finalForecastLabel}</td>
                      <td
                        style={{ textAlign: 'right' }}
                        className={`dev-cvr__variance dev-cvr__variance--${item.varianceState}`}
                      >
                        {item.varianceLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="cvr-summary__cost-summary-total">
                    <td>
                      <strong>Total</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{summary.commercialCostSummary.totals.budgetLabel}</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{summary.commercialCostSummary.totals.finalForecastLabel}</strong>
                    </td>
                    <td
                      style={{ textAlign: 'right' }}
                      className={`dev-cvr__variance dev-cvr__variance--${summary.commercialCostSummary.totals.varianceState}`}
                    >
                      <strong>{summary.commercialCostSummary.totals.varianceLabel}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p className="cvr-summary__hint">
                Select a commercial head to open the CVR worksheet filtered to that reporting group.
              </p>
            </div>
          ) : (
            <EmptyState message={summary.commercialCostSummary.emptyMessage} />
          )}
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
          <p className="cvr-summary__hint">{summary.developmentSummary.emptySalesHint}</p>
        </SummaryPanel>

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

      <CostCentreDrawer
        open={Boolean(selectedRow)}
        row={selectedRow}
        drawerBreadcrumbs={[
          ...(pageNavigation?.breadcrumbs || []),
          ...(selectedRow?.costCodeLabel ? [{ label: selectedRow.costCodeLabel }] : []),
        ]}
        packages={drawerPackages}
        ledgerRows={drawerLedgerRows}
        certificates={drawerCertificates}
        ledgerReady={!isLedgerServerAuthorityEnabled() || ledgerReadiness.ready}
        ledgerError={ledgerError}
        readOnly={summary.readOnly}
        onClose={() => setSelectedRow(null)}
        onSaveNotes={handleSaveNotes}
        onSaveCommercialAdjustment={handleSaveCommercialAdjustment}
      />

      <RejectDialog
        open={rejectOpen}
        onCancel={() => setRejectOpen(false)}
        onConfirm={handleReject}
      />
    </div>
  );
}
