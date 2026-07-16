import { useMemo, useState } from 'react';
import { formatMoney } from './poDrawerHelpers';
import TenureBadge from './TenureBadge';
import {
  REVENUE_BULK_ACTIONS,
  runBulkActionWorkflow,
} from '../revenue/revenueBulkWorkflow';
import {
  RevenueConfirmDialog,
  RevenueProgressPanel,
  RevenueToast,
} from './revenue/RevenueWorkflowUi';
import { useRevenueWorkflowState } from './revenue/useRevenueWorkflow';

export default function PlotRevenueOverrides({
  developmentId,
  plotOverrideRows = [],
  onOpenPlot,
  onChanged,
  variant = 'full',
}) {
  const rows = plotOverrideRows;
  const toolbarOnly = variant === 'toolbar';

  const [query, setQuery] = useState('');
  const [pendingAction, setPendingAction] = useState(null);
  const { toast, progress, busyActionKey, clearToast, runAction } = useRevenueWorkflowState();
  const isBusy = Boolean(busyActionKey);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.plotNumber, row.houseType, row.tenure, row.revenueSource, row.plotPremiumReason]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [rows, query]);

  async function handleBulkConfirm() {
    if (!pendingAction || isBusy) return;
    const action = pendingAction;
    setPendingAction(null);

    await runAction(action.key, {
      progressLabel: action.progressLabel,
      execute: () => runBulkActionWorkflow(developmentId, action),
      buildToast: (result) => action.buildToast(result),
      onPersisted: (result) => onChanged?.(result),
    });
  }

  const bulkActions = (
    <div className={`revenue-overrides__bulk${toolbarOnly ? ' revenue-overrides__bulk--toolbar' : ''}`}>
      {REVENUE_BULK_ACTIONS.map((action) => (
        <button
          key={action.key}
          type="button"
          className="po-list-btn-secondary"
          disabled={isBusy}
          aria-busy={busyActionKey === action.key}
          onClick={() => setPendingAction(action)}
        >
          {busyActionKey === action.key ? 'Working…' : action.label}
        </button>
      ))}
    </div>
  );

  const workflowUi = (
    <>
      <RevenueToast message={toast} onDismiss={clearToast} />
      <RevenueProgressPanel progress={progress} />
      <RevenueConfirmDialog
        open={Boolean(pendingAction) && !isBusy}
        title={pendingAction?.title}
        message={pendingAction?.message}
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        busy={false}
        onCancel={() => setPendingAction(null)}
        onConfirm={handleBulkConfirm}
      />
    </>
  );

  if (toolbarOnly) {
    return (
      <>
        {workflowUi}
        {bulkActions}
      </>
    );
  }

  return (
    <section className="po-module-card revenue-overrides" aria-labelledby="plot-revenue-overrides-title">
      {workflowUi}

      <header className="revenue-workspace__header">
        <h2 id="plot-revenue-overrides-title" className="po-matrix-section__title">Plot Revenue Overrides</h2>
        <p className="revenue-workspace__lead">
          Plot-level pricing with tenure, garage premiums, and overrides. Click a row to open the plot record.
        </p>
      </header>

      {bulkActions}

      <label className="revenue-overrides__search">
        <span className="revenue-register__filter-label">Search plots</span>
        <input
          className="input"
          type="search"
          value={query}
          placeholder="Plot, house type, tenure, source…"
          disabled={isBusy}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {filteredRows.length ? (
        <div className="po-table-wrap">
          <table className="po-data-table revenue-overrides__table">
            <thead>
              <tr>
                <th>Plot</th>
                <th>House Type</th>
                <th>Tenure</th>
                <th>Garage</th>
                <th>Revenue Source</th>
                <th>Plot Premium</th>
                <th>Reason</th>
                <th>Forecast</th>
                <th>Manual Override</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr
                  key={row.plotId}
                  className="revenue-register__data-row"
                  onClick={() => onOpenPlot?.(row.plotId)}
                >
                  <td>{row.plotNumber}</td>
                  <td>{row.houseType}</td>
                  <td>
                    <TenureBadge tenure={row.tenure} />
                  </td>
                  <td>
                    {row.garage}
                    {row.garageInherited ? (
                      <span className="revenue-overrides__inherited" title="Inherited from House Type">
                        {' '}(HT)
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={`revenue-source-chip${
                        row.isManualOverride ? ' revenue-source-chip--manual' : ''
                      }`}
                    >
                      {row.revenueSource}
                    </span>
                  </td>
                  <td>{row.plotPremium ? `£${formatMoney(row.plotPremium)}` : '—'}</td>
                  <td>{row.plotPremiumReason || '—'}</td>
                  <td>£{formatMoney(row.forecastSellingPrice)}</td>
                  <td>
                    {row.manualOverrideDisplay
                      ? `£${formatMoney(row.manualOverrideDisplay)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="revenue-register__empty">No plots match the current filters.</p>
      )}
    </section>
  );
}
