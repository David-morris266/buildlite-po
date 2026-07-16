import { formatMoney } from './poDrawerHelpers';
import { buildAffordableRevenueReconciliation } from '../revenue/revenueReconciliation';

function DiagnosticRow({ label, value }) {
  return (
    <div className="revenue-diagnostics__row">
      <span className="revenue-diagnostics__label">{label}</span>
      <span className="revenue-diagnostics__value">{value}</span>
    </div>
  );
}

function formatTimestamp(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('en-GB');
  } catch {
    return '—';
  }
}

function formatMoneyCell(value) {
  if (!value) return '£0';
  return `£${formatMoney(value)}`;
}

function ReconciliationTable({ reconciliation }) {
  if (!reconciliation) return null;

  const { rows, totals, reconciledSplit, summaryDevelopmentRevenue, dashboardMatchesReconciledSplit, divergence, flags } =
    reconciliation;

  return (
    <section className="revenue-diagnostics__reconciliation" aria-labelledby="revenue-reconciliation-title">
      <h3 id="revenue-reconciliation-title" className="revenue-diagnostics__heading">
        Affordable Revenue Reconciliation (live displayPricedPlots)
      </h3>
      <p className="revenue-diagnostics__intro">
        Same plot array as dashboard KPIs and Plot Revenue Register in this render.
      </p>

      <div className="revenue-diagnostics__reconciliation-totals">
        <DiagnosticRow label="Open Market revenue (by bucket)" value={formatMoneyCell(totals.openMarketRevenue)} />
        <DiagnosticRow label="Affordable Rent revenue" value={formatMoneyCell(totals.affordableRentRevenue)} />
        <DiagnosticRow label="Shared Ownership revenue" value={formatMoneyCell(totals.sharedOwnershipRevenue)} />
        <DiagnosticRow
          label="Other affordable tenure revenue"
          value={formatMoneyCell(totals.otherAffordableRevenue)}
        />
        <DiagnosticRow
          label="Total Affordable Housing (tenure sum)"
          value={formatMoneyCell(totals.totalAffordableHousingRevenue)}
        />
        <DiagnosticRow
          label="Total Affordable Housing (split fn)"
          value={formatMoneyCell(reconciledSplit.affordableHousingRevenue)}
        />
        <DiagnosticRow label="GDV (reconciled)" value={formatMoneyCell(totals.gdv)} />
        <DiagnosticRow label="Affordable % (reconciled)" value={`${totals.affordablePercent}%`} />
        <DiagnosticRow
          label="Dashboard affordableHousingRevenue"
          value={formatMoneyCell(summaryDevelopmentRevenue?.affordableHousingRevenue)}
        />
        <DiagnosticRow label="Dashboard GDV" value={formatMoneyCell(reconciliation.summaryGdv)} />
        <DiagnosticRow
          label="Dashboard Affordable %"
          value={
            reconciliation.summaryAffordablePercent != null
              ? `${reconciliation.summaryAffordablePercent}%`
              : '—'
          }
        />
        <DiagnosticRow
          label="Dashboard matches reconciled split"
          value={dashboardMatchesReconciledSplit ? 'Yes' : 'No — stale or different inputs'}
        />
        {divergence.affordableHousingRevenue !== null && divergence.affordableHousingRevenue !== 0 ? (
          <DiagnosticRow
            label="Affordable revenue divergence"
            value={formatMoneyCell(divergence.affordableHousingRevenue)}
          />
        ) : null}
        <DiagnosticRow
          label="SO plots bucketed openMarket"
          value={String(flags.openMarketSharedOwnershipCount)}
        />
        <DiagnosticRow
          label="SO plots excluded (zero split price)"
          value={String(flags.sharedOwnershipZeroSplitCount)}
        />
        <DiagnosticRow
          label="SO forecast but zero split"
          value={String(flags.sharedOwnershipForecastButZeroSplitCount)}
        />
      </div>

      <div className="po-table-wrap revenue-diagnostics__table-wrap">
        <table className="po-data-table revenue-diagnostics__table">
          <thead>
            <tr>
              <th>Plot</th>
              <th>Raw tenure</th>
              <th>Normalised</th>
              <th>Register tenure</th>
              <th>Revenue category</th>
              <th>Forecast</th>
              <th>effectivePrice</th>
              <th>getPlotEffectivePrice</th>
              <th>Split price</th>
              <th>percentKey</th>
              <th>Resulting bucket</th>
              <th>In split</th>
              <th>Included value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.plotId}
                className={
                  row.registerTenure === 'Shared Ownership' && row.bucket !== 'affordable'
                    ? 'revenue-diagnostics__row--warn'
                    : row.registerTenure === 'Shared Ownership' && !row.includedInSplit
                      ? 'revenue-diagnostics__row--warn'
                      : undefined
                }
              >
                <td>{row.plotNumber}</td>
                <td>{row.rawTenure || '—'}</td>
                <td>{row.normalizedTenure}</td>
                <td>{row.registerTenure}</td>
                <td>{row.revenueCategory || '—'}</td>
                <td>{formatMoneyCell(row.forecastSellingPrice)}</td>
                <td>{formatMoneyCell(row.effectivePrice)}</td>
                <td>{formatMoneyCell(row.getPlotEffectivePrice)}</td>
                <td>{formatMoneyCell(row.splitPrice)}</td>
                <td>{row.percentKey || '—'}</td>
                <td>{row.bucket}</td>
                <td>{row.includedInSplit ? 'Yes' : 'No'}</td>
                <td>{formatMoneyCell(row.includedValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function RevenueDiagnosticsPanel({
  diagnostics,
  displayPricedPlots = [],
  summary = null,
}) {
  if (!diagnostics) return null;

  const { sources, tenure, pricingAudit } = diagnostics;
  const reconciliation = buildAffordableRevenueReconciliation(displayPricedPlots, summary);

  return (
    <details className="po-module-card revenue-diagnostics revenue-diagnostics--collapsible">
      <summary className="revenue-diagnostics__summary">
        <span className="revenue-diagnostics__summary-title">Revenue Diagnostics</span>
        <span className="revenue-diagnostics__badge">Developer</span>
      </summary>

      <div className="revenue-diagnostics__body">
        <p className="revenue-diagnostics__intro">
          Developer mode only — pricing engine integration diagnostics. Not part of the commercial workflow.
        </p>

        <ReconciliationTable reconciliation={reconciliation} />

        <div className="revenue-diagnostics__grid">
          <div className="revenue-diagnostics__group">
            <h3 className="revenue-diagnostics__heading">Revenue Source</h3>
            <DiagnosticRow label="House Type" value={`${sources.houseType} plots`} />
            <DiagnosticRow label="Development Strategy" value={`${sources.developmentStrategy} plots`} />
            <DiagnosticRow label="Plot Override" value={`${sources.plotOverride} plots`} />
            <DiagnosticRow label="Manual Value" value={`${sources.manualValue} plots`} />
            <DiagnosticRow
              label="Protected Manual Overrides"
              value={diagnostics.protectedManualOverrides}
            />
            <DiagnosticRow
              label="Pricing inconsistencies"
              value={pricingAudit?.inconsistentCount ?? 0}
            />
          </div>

          <div className="revenue-diagnostics__group">
            <h3 className="revenue-diagnostics__heading">Tenure (raw plots passed to diagnostics)</h3>
            <DiagnosticRow label="Private" value={tenure.openMarket} />
            <DiagnosticRow label="Affordable Rent" value={tenure.affordableRent} />
            <DiagnosticRow label="Shared Ownership" value={tenure.sharedOwnership} />
            <DiagnosticRow label="First Homes" value={tenure.firstHomes} />
            <DiagnosticRow label="Additionality" value={tenure.additionality} />
            <DiagnosticRow label="Discount Market Sale" value={tenure.discountMarketSale} />
            <DiagnosticRow label="Other" value={tenure.other} />
          </div>

          <div className="revenue-diagnostics__group">
            <h3 className="revenue-diagnostics__heading">Engine</h3>
            <DiagnosticRow
              label="Garage Premium Total"
              value={`£${formatMoney(diagnostics.garagePremiumTotal)}`}
            />
            <DiagnosticRow
              label="Plot Premium Total"
              value={`£${formatMoney(diagnostics.plotPremiumTotal)}`}
            />
            <DiagnosticRow
              label="Average OM £/ft²"
              value={`£${formatMoney(diagnostics.averageOmPerFt2)}`}
            />
            <DiagnosticRow
              label="Average AH %"
              value={`${diagnostics.averageAhPercent}%`}
            />
            <DiagnosticRow label="Plots refreshed" value={diagnostics.plotsRecalculated} />
            <DiagnosticRow label="Plots skipped" value={diagnostics.plotsSkipped} />
            <DiagnosticRow label="Skip reason" value={diagnostics.skipReason || '—'} />
            <DiagnosticRow
              label="Last recalculation"
              value={formatTimestamp(diagnostics.lastRecalculationTime)}
            />
            <DiagnosticRow label="House Types updated" value={diagnostics.houseTypesUpdated} />
          </div>
        </div>
      </div>
    </details>
  );
}
