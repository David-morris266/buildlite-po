import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AdminKpiGrid } from './admin/adminUi';

import { formatMoney } from './poDrawerHelpers';

import HouseTypeRevenueTable from './HouseTypeRevenueTable';

import PlotRevenueOverrides from './PlotRevenueOverrides';

import RevenueDiagnosticsPanel from './RevenueDiagnosticsPanel';

import RevenueStrategyPanel from './RevenueStrategyPanel';

import RevenueHouseTypeSummary from './RevenueHouseTypeSummary';

import PlotDrawer from './PlotDrawer';
import SalesRegisterImportWizard from './SalesRegisterImportWizard';
import TenureBadge from './TenureBadge';

import { updatePlot } from '../developments/plotMaster';

import { ensureRevenueCategories } from '../admin/revenueCategoryStore';

import {

  REVENUE_STATUSES,

  REVENUE_STATUS_TONES,

} from '../developments/plotCommercial';

import {

  buildRevenueDashboardKpis,

  buildRevenueSummary,

  formatRevenueKpiValue,

} from '../revenue/revenueCalculations';

import {

  buildPlotRevenueRegisterRows,

  buildRevenueExceptions,
  groupRevenueExceptions,

  filterPlotRevenueRows,

  sortPlotRevenueRows,

} from '../revenue/plotRevenueEngine';
import { applySalesRegisterImport, previewSalesRegisterImport } from '../api/developments';
import { getDevelopment, refreshDevelopment } from '../developments/developmentStore';

import { buildRevenueDiagnostics } from '../revenue/revenueDiagnostics';

import { buildRevenuePricingModel } from '../revenue/revenuePricingModel';

import { buildRevenueHouseTypeSummary } from '../revenue/revenueHouseTypeSummary';

import { buildStrategyInsights } from '../revenue/revenueStrategyCalculations';

import { getRevenuePricingContext, emptyRevenueStrategy } from '../revenue/revenueStrategy';
import { saveRevenueRecord } from '../revenue/revenueStore';

import { REVENUE_STREAMS } from '../revenue/revenueTypes';



const showDeveloperDiagnostics = !import.meta.env.PROD;



const ACTIONABLE_INSIGHT_KEYS = new Set([

  'manual-overrides',

  'negative-premiums',

  'missing-nia',

  'missing-category',

]);



const REGISTER_COLUMNS = [

  { key: 'plotNumber', label: 'Plot' },

  { key: 'houseType', label: 'House Type' },

  { key: 'tenure', label: 'Tenure', format: 'tenure' },

  { key: 'revenueStatus', label: 'Status' },

  { key: 'pricingSource', label: 'Source' },

  { key: 'forecastSellingPrice', label: 'Forecast Price', format: 'money' },

  { key: 'perFt2', label: '£/ft²', format: 'rate' },

  { key: 'perM2', label: '£/m²', format: 'rate' },

];



const STATUS_STRIP_ITEMS = [

  { key: 'total', label: 'Plots' },

  { key: 'Available', label: 'Available' },

  { key: 'Reserved', label: 'Reserved' },

  { key: 'Exchanged', label: 'Exchanged' },

  { key: 'Completed', label: 'Completed' },

  { key: 'Cancelled', label: 'Cancelled' },

];



function RevenueStatusChip({ status }) {

  const tone = REVENUE_STATUS_TONES[status] || 'muted';

  return (

    <span className={`revenue-status-chip revenue-status-chip--${tone}`}>

      {status}

    </span>

  );

}



function formatRegisterCell(row, column) {

  if (column.key === 'revenueStatus') {

    return <RevenueStatusChip status={row.revenueStatus} />;

  }

  if (column.format === 'tenure') {

    return <TenureBadge tenure={row.tenure} />;

  }

  if (column.key === 'pricingSource') {

    return (

      <span

        className={`revenue-source-chip${

          row.isManualOverride ? ' revenue-source-chip--manual' : ''

        }`}

      >

        {row.pricingSource || row.revenueSource || 'House Type'}

      </span>

    );

  }

  if (column.format === 'money') {

    const amount = row[column.key];

    return amount ? `£${formatMoney(amount)}` : '—';

  }

  if (column.format === 'rate') {

    const amount = row[column.key];

    return amount ? `£${formatMoney(amount)}` : '—';

  }

  return row[column.key] || '—';

}



export default function RevenueWorkspace({

  developmentId,

  refreshToken = 0,

  onRevenueChanged,

}) {

  ensureRevenueCategories();



  const [localRefresh, setLocalRefresh] = useState(0);

  const [strategyPreview, setStrategyPreview] = useState(null);

  const [houseTypePreview, setHouseTypePreview] = useState(null);

  const strategyDraftBaseline = useRef(null);

  const houseTypeDraftBaseline = useRef(null);

  const [pricingDraftDirty, setPricingDraftDirty] = useState(false);

  const [lastWorkflowStats, setLastWorkflowStats] = useState(null);

  const [drawerPlotId, setDrawerPlotId] = useState(null);

  const [drawerErrors, setDrawerErrors] = useState([]);



  const handleStrategyPreview = useCallback((draft) => {
    const serialised = JSON.stringify(draft);
    if (strategyDraftBaseline.current === null) strategyDraftBaseline.current = serialised;
    else setPricingDraftDirty((current) => current || serialised !== strategyDraftBaseline.current);
    setStrategyPreview(draft);

  }, []);



  const handleHouseTypePreview = useCallback((draft) => {
    const serialised = JSON.stringify(draft);
    if (houseTypeDraftBaseline.current === null) houseTypeDraftBaseline.current = serialised;
    else setPricingDraftDirty((current) => current || serialised !== houseTypeDraftBaseline.current);
    setHouseTypePreview(draft);

  }, []);



  const [pricingContext, setPricingContext] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [summaryLines, setSummaryLines] = useState([]);
  const [selectedRevenueView, setSelectedRevenueView] = useState(null);
  const [savingSummary, setSavingSummary] = useState(false);
  const [summaryMessage, setSummaryMessage] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState('overview');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setPricingContext(null);

    getRevenuePricingContext(developmentId, {
      refresh: Boolean(refreshToken) || localRefresh > 0,
    })
      .then((context) => {
        if (!cancelled) {
          setPricingContext(context);
          setSummaryLines(context.summaryRevenueLines || []);
          setSelectedRevenueView((current) => current || context.revenueMode || 'sales_register');
          setLoadError('');
          setLoading(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPricingContext(null);
          setLoadError(
            error?.message || 'Unable to load Revenue data. Please try again.'
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [developmentId, refreshToken, localRefresh]);

  const plots = useMemo(() => pricingContext?.plots || [], [pricingContext]);
  const strategy = pricingContext?.strategy || emptyRevenueStrategy();
  const houseTypePricing = pricingContext?.houseTypePricing || {};



  const effectiveStrategy = strategyPreview || strategy;

  const effectiveHouseTypes = houseTypePreview || houseTypePricing;



  const pricingModel = useMemo(

    () =>

      buildRevenuePricingModel({

        plots,

        strategy: effectiveStrategy,

        houseTypePricing: effectiveHouseTypes,

      }),

    [plots, effectiveStrategy, effectiveHouseTypes]

  );



  const {

    pricedPlots: displayPricedPlots,

    strategyMetrics: displayMetrics,

    houseTypeRows,

    plotOverrideRows,

  } = pricingModel;



  const summary = useMemo(

    () =>

      buildRevenueSummary({

        plots,

        pricedPlots: displayPricedPlots,

        strategyMetrics: displayMetrics,

      }),

    [plots, displayPricedPlots, displayMetrics]

  );



  const forecastSourceCounts = useMemo(() => ({
    imported: plots.filter((plot) => (
      plot.revenueSource === 'Manual Value' &&
      Boolean(plot.forecastImportProvenance) &&
      !plot.forecastImportProvenance.supersededAt
    )).length,
    manual: plots.filter((plot) => (
      plot.revenueSource === 'Manual Value' &&
      plot.manualOverrideExplicit === true &&
      (!plot.forecastImportProvenance || Boolean(plot.forecastImportProvenance.supersededAt))
    )).length,
  }), [plots]);

  const dashboardKpis = useMemo(() => [
    ...buildRevenueDashboardKpis(summary).filter((item) => item.key !== 'manualOverrides'),
    { key: 'importedForecasts', label: 'Imported forecasts', value: forecastSourceCounts.imported, format: 'count' },
    { key: 'genuineManualOverrides', label: 'Manual overrides', value: forecastSourceCounts.manual, format: 'count' },
  ], [summary, forecastSourceCounts]);



  const registerRows = useMemo(

    () => buildPlotRevenueRegisterRows(displayPricedPlots),

    [displayPricedPlots]

  );



  const houseTypeSummary = useMemo(

    () => buildRevenueHouseTypeSummary(displayPricedPlots),

    [displayPricedPlots]

  );



  const insights = useMemo(

    () => buildStrategyInsights(plots, effectiveStrategy, pricingModel.houseTypePricing),

    [plots, effectiveStrategy, pricingModel.houseTypePricing]

  );



  const exceptions = useMemo(() => buildRevenueExceptions(displayPricedPlots), [displayPricedPlots]);
  const exceptionGroups = useMemo(() => groupRevenueExceptions(exceptions), [exceptions]);



  const { actionableInsights, benchmarkInsights } = useMemo(() => {

    if (!insights.available) {

      return { actionableInsights: [], benchmarkInsights: [] };

    }

    return {

      actionableInsights: insights.items.filter((item) => ACTIONABLE_INSIGHT_KEYS.has(item.key)),

      benchmarkInsights: insights.items.filter((item) => !ACTIONABLE_INSIGHT_KEYS.has(item.key)),

    };

  }, [insights]);



  const diagnostics = useMemo(() => {

    if (!showDeveloperDiagnostics) return null;

    return buildRevenueDiagnostics({

      plots,

      strategyMetrics: displayMetrics,

      houseTypePricing: pricingModel.houseTypePricing,

      lastWorkflowStats,

    });

  }, [plots, displayMetrics, pricingModel.houseTypePricing, lastWorkflowStats]);



  const drawerPlot = useMemo(

    () => plots.find((plot) => plot.id === drawerPlotId) || null,

    [plots, drawerPlotId]

  );



  const [registerQuery, setRegisterQuery] = useState('');

  const [registerStatus, setRegisterStatus] = useState('');

  const [sortKey, setSortKey] = useState('plotNumber');

  const [sortDirection, setSortDirection] = useState('asc');



  const filteredRows = useMemo(

    () =>

      sortPlotRevenueRows(

        filterPlotRevenueRows(registerRows, {

          query: registerQuery,

          status: registerStatus,

        }),

        { key: sortKey, direction: sortDirection }

      ),

    [registerRows, registerQuery, registerStatus, sortKey, sortDirection]

  );



  function handleStrategyChanged(workflowStats) {

    setStrategyPreview(null);

    setHouseTypePreview(null);

    strategyDraftBaseline.current = null;

    houseTypeDraftBaseline.current = null;

    setPricingDraftDirty(false);

    setLocalRefresh((value) => value + 1);

    if (workflowStats) {

      setLastWorkflowStats({

        ...workflowStats,

        recalculatedAt: new Date().toISOString(),

      });

    }

    onRevenueChanged?.();

  }



  function handleOpenPlot(plotId) {

    if (!plotId) return;

    setWorkspaceView('register');
    setDrawerPlotId(plotId);

    setDrawerErrors([]);

  }



  function closePlotDrawer() {

    setDrawerPlotId(null);

    setDrawerErrors([]);

  }



  async function handlePlotSave(formData) {

    if (!drawerPlotId) return;

    const result = await updatePlot(developmentId, drawerPlotId, formData);

    if (!result.ok) {

      setDrawerErrors(result.errors || ['Could not save plot.']);

      return;

    }

    closePlotDrawer();

    handleStrategyChanged({

      updatedCount: 1,

      plotsRecalculated: 1,

      source: 'plot-drawer',

    });

  }



  function handleSort(columnKey) {

    if (sortKey === columnKey) {

      setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'));

      return;

    }

    setSortKey(columnKey);

    setSortDirection('asc');

  }



  const statusCounts = summary.statusCounts || {};

  const hasCommercialActions = exceptions.length > 0 || actionableInsights.length > 0;

  async function saveRevenueMode(revenueMode, lines = summaryLines) {
    const nextSummaryTotal = lines.reduce((sum, line) => sum + (Number(line.forecastRevenue) || 0), 0);
    const authorityMessage = revenueMode === 'summary'
      ? `Switch Revenue mode to Summary Revenue with a Forecast Revenue total of £${formatMoney(nextSummaryTotal)}? Existing data will be preserved but only Summary Revenue will contribute to CVR Revenue.`
      : 'Switch Revenue mode to Sales Register? Existing data will be preserved but only the Sales Register will contribute to CVR Revenue.';
    if (revenueMode !== pricingContext.revenueMode && !window.confirm(authorityMessage)) return;
    setSavingSummary(true); setSummaryMessage('');
    const result = await saveRevenueRecord(developmentId, { ...pricingContext.settings, revenueMode, summaryRevenueLines: lines });
    setSavingSummary(false);
    if (!result?.ok) { setSummaryMessage(result?.errors?.[0] || 'Could not save Revenue.'); return; }
    setSummaryMessage('Revenue saved.');
    setLocalRefresh((value) => value + 1); onRevenueChanged?.();
  }

  async function handleSalesRegisterApply(payload) {
    await applySalesRegisterImport(developmentId, payload);
    await refreshDevelopment(developmentId);
    setImportOpen(false);
    setWorkspaceView('overview');
    setSummaryMessage(`Sales Register import applied to ${payload.updates.length} plot${payload.updates.length === 1 ? '' : 's'}.`);
    handleStrategyChanged({ updatedCount: payload.updates.length, source: 'sales-register-import' });
  }

  function handleSalesRegisterPreview(payload) {
    return previewSalesRegisterImport(developmentId, payload);
  }



  if (loadError) {
    return (
      <div className="revenue-workspace revenue-workspace--error">
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {loadError}
        </div>
      </div>
    );
  }

  if (loading || !pricingContext) {
    return (
      <div className="revenue-workspace revenue-workspace--loading">
        <p className="revenue-workspace__lead">Loading revenue data…</p>
      </div>
    );
  }

  const activeRevenueView = selectedRevenueView || pricingContext.revenueMode || 'sales_register';
  const authorityLabel = pricingContext.revenueMode === 'summary' ? 'Summary Revenue' : 'Plot-level Sales Register';
  const summaryForecastRevenue = summaryLines.reduce(
    (sum, line) => sum + (Number(line.forecastRevenue) || 0),
    0
  );
  const persistedSummaryForecastRevenue = (pricingContext.summaryRevenueLines || []).reduce(
    (sum, line) => sum + (Number(line.forecastRevenue) || 0),
    0
  );
  const overviewForecastRevenue = pricingContext.revenueMode === 'summary'
    ? persistedSummaryForecastRevenue
    : summary.forecastRevenue;
  const usesIllustrativePlotForecast = pricingContext.revenueMode === 'sales_register' &&
    pricingContext.settings?.exists === false &&
    !(plots.length > 0 && forecastSourceCounts.imported === plots.length);
  const hasUnsavedSummaryDraft = JSON.stringify(summaryLines) !== JSON.stringify(pricingContext.summaryRevenueLines || []);
  function returnToRevenueOverview() {
    if (workspaceView === 'pricing' && pricingDraftDirty && !window.confirm('Discard unsaved Pricing Assumptions changes and return to the Revenue overview?')) return;
    if (workspaceView === 'summary' && hasUnsavedSummaryDraft && !window.confirm('Discard unsaved Summary Revenue changes and return to the Revenue overview?')) return;
    setStrategyPreview(null);
    setHouseTypePreview(null);
    strategyDraftBaseline.current = null;
    houseTypeDraftBaseline.current = null;
    setPricingDraftDirty(false);
    if (workspaceView === 'summary') setSummaryLines(pricingContext.summaryRevenueLines || []);
    closePlotDrawer();
    setWorkspaceView('overview');
  }
  const plotSourceState = forecastSourceCounts.imported === plots.length && plots.length
    ? 'Independent imported forecasts established for every plot.'
    : `${forecastSourceCounts.imported} imported forecast${forecastSourceCounts.imported === 1 ? '' : 's'}, ${forecastSourceCounts.manual} genuine manual override${forecastSourceCounts.manual === 1 ? '' : 's'}.`;

  if (importOpen && activeRevenueView === 'sales_register') {
    return (
      <div className="revenue-workspace revenue-workspace--sales-import">
        <SalesRegisterImportWizard
          plots={plots}
          developmentVersion={getDevelopment(developmentId)?.version}
          onPreview={handleSalesRegisterPreview}
          onCancel={() => setImportOpen(false)}
          onApply={handleSalesRegisterApply}
        />
      </div>
    );
  }

  if (workspaceView === 'overview') {
    return (
      <div className="revenue-workspace revenue-overview">
        <header className="revenue-overview__header">
          <div>
            <p className="revenue-workspace__zone-eyebrow">Revenue overview</p>
            <h2 className="po-matrix-section__title">Current Revenue position</h2>
            <p className="revenue-workspace__lead">Review the authoritative position, then open only the task you need.</p>
          </div>
          <span className="revenue-overview__authority">CVR authority: {authorityLabel}</span>
        </header>

        {summaryMessage ? <p className="po-list-feedback" role="status">{summaryMessage}</p> : null}

        <div className="revenue-overview__kpis" aria-label="Revenue overview measures">
          <article><span>{usesIllustrativePlotForecast ? 'Illustrative forecast — not established' : 'Forecast Revenue'}</span><strong>£{formatMoney(overviewForecastRevenue || 0)}</strong></article>
          <article><span>Plots</span><strong>{plots.length}</strong></article>
          <article><span>Imported forecasts</span><strong>{forecastSourceCounts.imported}</strong></article>
          <article><span>Manual overrides</span><strong>{forecastSourceCounts.manual}</strong></article>
          <article><span>Material exceptions</span><strong>{exceptions.length}</strong></article>
        </div>

        <div className="revenue-overview__modes">
          <article className={`revenue-overview__mode${pricingContext.revenueMode === 'summary' ? ' revenue-overview__mode--authoritative' : ''}`}>
            <div className="revenue-overview__mode-heading">
              <h3>Summary Revenue</h3>
              {pricingContext.revenueMode === 'summary' ? <span>Authoritative</span> : null}
            </div>
            <p>Maintain a concise development-level Forecast Revenue without plot pricing or sales lifecycle metrics.</p>
            <p><strong>{summaryLines.length} revenue line{summaryLines.length === 1 ? '' : 's'}</strong> · £{formatMoney(summaryForecastRevenue)}</p>
            <div className="po-button-row">
              <button type="button" className="po-button" onClick={() => { setSelectedRevenueView('summary'); setWorkspaceView('summary'); }}>Open Summary Revenue</button>
              {pricingContext.revenueMode !== 'summary' ? <button type="button" className="po-button" disabled={savingSummary} onClick={() => saveRevenueMode('summary', summaryLines.length ? summaryLines : [{ id: crypto.randomUUID(), description: 'Total Forecast Revenue', forecastRevenue: 0 }])}>Use for CVR Revenue</button> : null}
            </div>
          </article>

          <article className={`revenue-overview__mode${pricingContext.revenueMode === 'sales_register' ? ' revenue-overview__mode--authoritative' : ''}`}>
            <div className="revenue-overview__mode-heading">
              <h3>Plot-level Sales Register</h3>
              {pricingContext.revenueMode === 'sales_register' ? <span>Authoritative</span> : null}
            </div>
            <p>{plotSourceState}</p>
            {pricingContext.settings?.exists === false && !(plots.length > 0 && forecastSourceCounts.imported === plots.length) ? <p className="revenue-overview__illustrative"><strong>Pricing assumptions are not established.</strong> Displayed £350/ft² and affordable percentages are illustrative only.</p> : null}
            <div className="revenue-overview__actions">
              <button type="button" className="po-button po-button--primary" onClick={() => { setSelectedRevenueView('sales_register'); setImportOpen(true); }}>Import Sales Register</button>
              <button type="button" className="po-button" onClick={() => { setSelectedRevenueView('sales_register'); setWorkspaceView('pricing'); }}>Pricing Assumptions</button>
              <button type="button" className="po-button" onClick={() => { setSelectedRevenueView('sales_register'); setWorkspaceView('register'); }}>Plot Revenue Register</button>
              <button type="button" className="po-button" onClick={() => { setSelectedRevenueView('sales_register'); setWorkspaceView('analysis'); }}>Revenue Analysis</button>
              {pricingContext.revenueMode !== 'sales_register' ? <button type="button" className="po-button" disabled={savingSummary} onClick={() => saveRevenueMode('sales_register')}>Use for CVR Revenue</button> : null}
            </div>
          </article>
        </div>
      </div>
    );
  }



  return (

    <div className="revenue-workspace">
      <div className="revenue-workspace__working-header">
        <button type="button" className="po-list-btn-secondary" onClick={returnToRevenueOverview}>← Back to Revenue overview</button>
        <span className="revenue-overview__authority">CVR authority: {authorityLabel}</span>
      </div>
      {workspaceView === 'summary' ? (
        <section className="revenue-workspace__section" aria-labelledby="summary-revenue-title">
          <h2 id="summary-revenue-title" className="po-matrix-section__title">Summary Revenue</h2>
          <p className="revenue-workspace__lead">Secured Revenue, Remaining Forecast and plot sales are not tracked in Summary Revenue.</p>
          <div className="po-table-wrap"><table className="po-table"><thead><tr><th>Description</th><th>Forecast Revenue</th><th aria-label="Actions" /></tr></thead><tbody>
            {summaryLines.map((line, index) => <tr key={line.id}><td><input aria-label={`Revenue line ${index + 1} description`} value={line.description} onChange={(event) => setSummaryLines((rows) => rows.map((row) => row.id === line.id ? {...row, description:event.target.value} : row))} /></td><td><input aria-label={`Revenue line ${index + 1} forecast revenue`} type="number" min="0" step="0.01" value={line.forecastRevenue} onChange={(event) => setSummaryLines((rows) => rows.map((row) => row.id === line.id ? {...row, forecastRevenue:event.target.value} : row))} /></td><td><button type="button" className="po-button" onClick={() => setSummaryLines((rows) => rows.filter((row) => row.id !== line.id))}>Remove</button></td></tr>)}
          </tbody></table></div>
          <p><strong>Total Forecast Revenue:</strong> £{summaryLines.reduce((sum, line) => sum + (Number(line.forecastRevenue) || 0), 0).toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2})}</p>
          <div className="po-button-row"><button type="button" className="po-button" onClick={() => setSummaryLines((rows) => [...rows, {id:crypto.randomUUID(), description:'', forecastRevenue:0}])}>Add Revenue Line</button><button type="button" className="po-button po-button--primary" disabled={savingSummary} onClick={() => saveRevenueMode(pricingContext.revenueMode)}>{savingSummary ? 'Saving…' : 'Save Summary Lines'}</button></div>
        </section>
      ) : null}

      {activeRevenueView === 'sales_register' ? <>

      {workspaceView === 'pricing' && pricingContext.settings?.exists === false ? <p className="po-list-feedback po-list-feedback--warning" role="status"><strong>Pricing Assumptions are optional and not established.</strong> The displayed £350/ft² and affordable percentages are illustrative defaults only. Independent imported forecasts do not require these assumptions.</p> : null}

      {workspaceView === 'pricing' ? <div className="revenue-workspace__zone revenue-workspace__zone--assumptions">

        <p className="revenue-workspace__zone-eyebrow">What pricing assumptions am I using?</p>



        <RevenueStrategyPanel

          developmentId={developmentId}

          refreshToken={refreshToken + localRefresh}

          onStrategyChanged={handleStrategyChanged}

          onDraftChange={handleStrategyPreview}

        />



        <HouseTypeRevenueTable

          developmentId={developmentId}

          refreshToken={refreshToken + localRefresh}

          houseTypeRows={houseTypeRows}

          onDraftChange={handleHouseTypePreview}

          onChanged={handleStrategyChanged}

        />

      </div> : null}



      {workspaceView === 'analysis' ? <div className="revenue-workspace__zone revenue-workspace__zone--position">

        <p className="revenue-workspace__zone-eyebrow">What is the current commercial position?</p>



        <section className="revenue-workspace__section" aria-labelledby="revenue-dashboard-title">

          <header className="revenue-workspace__header revenue-workspace__header--compact">

            <h2 id="revenue-dashboard-title" className="po-matrix-section__title">Revenue Dashboard</h2>

            <p className="revenue-workspace__lead">

              Live commercial KPIs from the pricing engine.

            </p>

          </header>

          <AdminKpiGrid

            className="revenue-kpi-grid"

            items={dashboardKpis.map((kpi) => ({

              label: kpi.label,

              value: formatRevenueKpiValue(kpi),

              hint: kpi.hint,

            }))}

          />

        </section>



        <div className="revenue-position-strip">

          <div className="revenue-position-strip__status" aria-label="Plot status counts">

            {STATUS_STRIP_ITEMS.map((item) => (

              <span key={item.key} className="revenue-position-strip__chip">

                <span className="revenue-position-strip__chip-label">{item.label}</span>

                <strong className="revenue-position-strip__chip-value">

                  {String(statusCounts[item.key] ?? 0)}

                </strong>

              </span>

            ))}

          </div>



          <section className="po-module-card revenue-split revenue-split--compact" aria-labelledby="revenue-split-title">

            <div className="revenue-split__compact-row">

              <h2 id="revenue-split-title" className="revenue-split__compact-title">Revenue Split</h2>

              <div className="revenue-split__grid revenue-split__grid--compact">

                {REVENUE_STREAMS.map((stream) => (

                  <article key={stream.key} className="revenue-split__item revenue-split__item--compact">

                    <span className="revenue-split__label">{stream.label}</span>

                    <strong className="revenue-split__value">

                      £{formatMoney(summary.developmentRevenue[stream.key])}

                    </strong>

                  </article>

                ))}

              </div>

              <div className="revenue-split__total revenue-split__total--inline">

                <span className="revenue-split__total-label">GDV</span>

                <strong className="revenue-split__total-value">

                  £{formatMoney(summary.grossDevelopmentValue)}

                </strong>

              </div>

            </div>

          </section>

        </div>



        <RevenueHouseTypeSummary summary={houseTypeSummary} />

      </div> : null}



      {(workspaceView === 'register' || workspaceView === 'analysis') ? <div className="revenue-workspace__zone revenue-workspace__zone--intervention">

        <p className="revenue-workspace__zone-eyebrow">Where do I need to intervene?</p>



        {workspaceView === 'register' ? <section className="po-module-card revenue-register" aria-labelledby="plot-revenue-register-title">

          <header className="revenue-register__header">

            <div className="revenue-register__header-copy">

              <h2 id="plot-revenue-register-title" className="po-matrix-section__title">Plot Revenue Register</h2>

              <p className="revenue-workspace__lead">

                Primary working register — click a row to open the plot record.

              </p>

            </div>

            <PlotRevenueOverrides

              developmentId={developmentId}

              plotOverrideRows={plotOverrideRows}

              onOpenPlot={handleOpenPlot}

              onChanged={handleStrategyChanged}

              variant="toolbar"

            />

            <button type="button" className="po-btn-primary" onClick={() => setImportOpen(true)}>
              Import Sales Register
            </button>

          </header>



          <div className="revenue-register__filters">

            <label className="revenue-register__filter">

              <span className="revenue-register__filter-label">Search</span>

              <input

                className="input"

                type="search"

                value={registerQuery}

                placeholder="Plot, house type, status…"

                onChange={(event) => setRegisterQuery(event.target.value)}

              />

            </label>

            <label className="revenue-register__filter">

              <span className="revenue-register__filter-label">Status</span>

              <select

                className="input"

                value={registerStatus}

                onChange={(event) => setRegisterStatus(event.target.value)}

              >

                <option value="">All statuses</option>

                {REVENUE_STATUSES.map((status) => (

                  <option key={status} value={status}>{status}</option>

                ))}

              </select>

            </label>

          </div>



          {filteredRows.length ? (

            <div className="po-table-wrap">

              <table className="po-data-table revenue-register__table">

                <thead>

                  <tr>

                    {REGISTER_COLUMNS.map((column) => (

                      <th key={column.key}>

                        <button

                          type="button"

                          className="revenue-register__sort"

                          onClick={() => handleSort(column.key)}

                        >

                          {column.label}

                          {sortKey === column.key ? (

                            <span className="revenue-register__sort-indicator" aria-hidden="true">

                              {sortDirection === 'asc' ? '↑' : '↓'}

                            </span>

                          ) : null}

                        </button>

                      </th>

                    ))}

                  </tr>

                </thead>

                <tbody>

                  {filteredRows.map((row) => (

                    <tr

                      key={row.plotId}

                      className="revenue-register__data-row"

                      onClick={() => handleOpenPlot(row.plotId)}

                    >

                      {REGISTER_COLUMNS.map((column) => (

                        <td key={column.key}>{formatRegisterCell(row, column)}</td>

                      ))}

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

          ) : (

            <p className="revenue-register__empty">

              {plots.length

                ? 'No plots match the current filters.'

                : 'Plot revenue records will appear once plots are added in Plot Master.'}

            </p>

          )}

        </section> : null}

        {workspaceView === 'analysis' ? <section className="po-module-card revenue-actions" aria-labelledby="commercial-actions-title">

          <header className="revenue-workspace__header revenue-workspace__header--compact">

            <h2 id="commercial-actions-title" className="po-matrix-section__title">Commercial Actions</h2>

            <p className="revenue-workspace__lead">

              Exceptions and pricing issues that need attention.

            </p>

          </header>



          {!hasCommercialActions && !benchmarkInsights.length ? (

            <p className="revenue-actions__empty">{insights.emptyMessage}</p>

          ) : null}



          {exceptions.length ? (

            <div className="revenue-actions__group">

              <h3 className="revenue-actions__group-title">Exceptions</h3>

              <ul className="revenue-exceptions__list">

                {exceptionGroups.map((group) => (
                  <li key={group.id} className="revenue-exceptions__card">
                    <span className="revenue-exceptions__label">
                      {group.label} — {group.count} plot{group.count === 1 ? '' : 's'}
                    </span>
                    <span className="revenue-exceptions__message">{group.plotNumbers.join(', ')}</span>
                    <span className="revenue-exceptions__detail-actions">
                      {group.items.map((item) => (
                        <button type="button" className="revenue-insights__link" key={item.id} onClick={() => handleOpenPlot(item.plotId)}>
                          Plot {item.plotNumber}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}

              </ul>

            </div>

          ) : hasCommercialActions ? (

            <p className="revenue-actions__clear">No revenue exceptions detected.</p>

          ) : null}



          {actionableInsights.length ? (

            <div className="revenue-actions__group">

              <h3 className="revenue-actions__group-title">Pricing Actions</h3>

              <ul className="revenue-insights__list revenue-insights__list--action">

                {actionableInsights.map((item) => (

                  <li key={item.key} className="revenue-insights__item revenue-insights__item--action">

                    <span className="revenue-insights__label">{item.label}</span>

                    {item.plotId ? (

                      <button

                        type="button"

                        className="revenue-insights__link"

                        onClick={() => handleOpenPlot(item.plotId)}

                      >

                        {item.value}

                      </button>

                    ) : (

                      <strong className="revenue-insights__value">{item.value}</strong>

                    )}

                  </li>

                ))}

              </ul>

            </div>

          ) : null}



          {benchmarkInsights.length ? (

            <div className="revenue-actions__group revenue-actions__group--benchmarks">

              <h3 className="revenue-actions__group-title">Benchmarks</h3>

              <ul className="revenue-insights__list revenue-insights__list--benchmark">

                {benchmarkInsights.map((item) => (

                  <li key={item.key} className="revenue-insights__item revenue-insights__item--benchmark">

                    <span className="revenue-insights__label">{item.label}</span>

                    {item.plotId ? (

                      <button

                        type="button"

                        className="revenue-insights__link revenue-insights__link--muted"

                        onClick={() => handleOpenPlot(item.plotId)}

                      >

                        {item.value}

                      </button>

                    ) : (

                      <strong className="revenue-insights__value revenue-insights__value--muted">

                        {item.value}

                      </strong>

                    )}

                  </li>

                ))}

              </ul>

            </div>

          ) : null}

        </section> : null}

      </div> : null}



      {workspaceView === 'analysis' && showDeveloperDiagnostics ? (
        <RevenueDiagnosticsPanel
          diagnostics={diagnostics}
          displayPricedPlots={displayPricedPlots}
          summary={summary}
        />
      ) : null}



      {workspaceView === 'register' ? <PlotDrawer

        open={Boolean(drawerPlotId)}

        plot={drawerPlot}

        developmentId={developmentId}

        openedFrom="Revenue"

        saveErrors={drawerErrors}

        onClose={closePlotDrawer}

        onSave={handlePlotSave}

      /> : null}

      </> : null}
    </div>

  );

}


