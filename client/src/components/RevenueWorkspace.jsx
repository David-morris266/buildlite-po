import { useCallback, useMemo, useState } from 'react';

import { AdminKpiGrid } from './admin/adminUi';

import { formatMoney } from './poDrawerHelpers';

import HouseTypeRevenueTable from './HouseTypeRevenueTable';

import PlotRevenueOverrides from './PlotRevenueOverrides';

import RevenueDiagnosticsPanel from './RevenueDiagnosticsPanel';

import RevenueStrategyPanel from './RevenueStrategyPanel';

import PlotDrawer from './PlotDrawer';
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

  filterPlotRevenueRows,

  sortPlotRevenueRows,

} from '../revenue/plotRevenueEngine';

import { buildRevenueDiagnostics } from '../revenue/revenueDiagnostics';

import { buildRevenuePricingModel } from '../revenue/revenuePricingModel';

import { buildStrategyInsights } from '../revenue/revenueStrategyCalculations';

import { getRevenuePricingContext } from '../revenue/revenueStrategy';

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

  const [lastWorkflowStats, setLastWorkflowStats] = useState(null);

  const [drawerPlotId, setDrawerPlotId] = useState(null);

  const [drawerErrors, setDrawerErrors] = useState([]);



  const handleStrategyPreview = useCallback((draft) => {

    setStrategyPreview(draft);

  }, []);



  const handleHouseTypePreview = useCallback((draft) => {

    setHouseTypePreview(draft);

  }, []);



  const pricingContext = useMemo(() => {

    void refreshToken;

    void localRefresh;

    return getRevenuePricingContext(developmentId);

  }, [developmentId, refreshToken, localRefresh]);



  const { plots, strategy, houseTypePricing } = pricingContext;



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



  const dashboardKpis = useMemo(() => buildRevenueDashboardKpis(summary), [summary]);



  const registerRows = useMemo(

    () => buildPlotRevenueRegisterRows(displayPricedPlots),

    [displayPricedPlots]

  );



  const insights = useMemo(

    () => buildStrategyInsights(plots, effectiveStrategy, pricingModel.houseTypePricing),

    [plots, effectiveStrategy, pricingModel.houseTypePricing]

  );



  const exceptions = useMemo(() => buildRevenueExceptions(displayPricedPlots), [displayPricedPlots]);



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

    setDrawerPlotId(plotId);

    setDrawerErrors([]);

  }



  function closePlotDrawer() {

    setDrawerPlotId(null);

    setDrawerErrors([]);

  }



  function handlePlotSave(formData) {

    if (!drawerPlotId) return;

    const result = updatePlot(developmentId, drawerPlotId, formData);

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



  return (

    <div className="revenue-workspace">

      <div className="revenue-workspace__zone revenue-workspace__zone--assumptions">

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

      </div>



      <div className="revenue-workspace__zone revenue-workspace__zone--position">

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

      </div>



      <div className="revenue-workspace__zone revenue-workspace__zone--intervention">

        <p className="revenue-workspace__zone-eyebrow">Where do I need to intervene?</p>



        <section className="po-module-card revenue-register" aria-labelledby="plot-revenue-register-title">

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

        </section>



        <section className="po-module-card revenue-actions" aria-labelledby="commercial-actions-title">

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

                {exceptions.map((item) => (

                  <li key={item.id}>

                    <button

                      type="button"

                      className="revenue-exceptions__card revenue-exceptions__card--action"

                      onClick={() => handleOpenPlot(item.plotId)}

                    >

                      <span className="revenue-exceptions__label">{item.label}</span>

                      <span className="revenue-exceptions__message">{item.message}</span>

                    </button>

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

        </section>

      </div>



      {showDeveloperDiagnostics ? (
        <RevenueDiagnosticsPanel
          diagnostics={diagnostics}
          displayPricedPlots={displayPricedPlots}
          summary={summary}
        />
      ) : null}



      <PlotDrawer

        open={Boolean(drawerPlotId)}

        plot={drawerPlot}

        developmentId={developmentId}

        openedFrom="Revenue"

        saveErrors={drawerErrors}

        onClose={closePlotDrawer}

        onSave={handlePlotSave}

      />

    </div>

  );

}


