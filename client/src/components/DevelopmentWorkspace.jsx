import { useEffect, useMemo, useState } from 'react';
import POPageHeader from './POPageHeader';
import { listPOs } from '../api';import { updateDevelopment } from '../developments/developmentStore';
import { subscribeCommercialChanged } from '../commercial/commercialEvents';
import { buildDevelopmentWorkspaceModel } from '../developments/developmentHelpers';
import DevelopmentOverview, {
  DevelopmentCommercialTab,
  DevelopmentPackagesTab,
  SummaryDashboard,
} from './DevelopmentOverview';
import PlotMaster from './PlotMaster';
import PurchaseLedger from './PurchaseLedger';
import CVRRegister from './CVRRegister';
import CVRWorkspace from './CVRWorkspace';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'plot-master', label: 'Plot Master' },
  { id: 'packages', label: 'Packages' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'cvr', label: 'CVR' },
];

function StatusBadge({ status }) {
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

export default function DevelopmentWorkspace({
  development,
  onBackToList,
  onPlotsChanged,
  onLedgerChanged,
  onCvrChanged,
  onDevelopmentChanged,
  initialActiveTab = null,
  initialCvrPeriodKey = null,
}) {
  const [activeTab, setActiveTab] = useState(initialActiveTab || 'overview');
  const [cvrView, setCvrView] = useState(initialCvrPeriodKey ? 'workspace' : 'register');
  const [cvrPeriodKey, setCvrPeriodKey] = useState(initialCvrPeriodKey);
  const [plotRefresh, setPlotRefresh] = useState(0);
  const [ledgerRefresh, setLedgerRefresh] = useState(0);
  const [cvrRefresh, setCvrRefresh] = useState(0);
  const [commercialRefresh, setCommercialRefresh] = useState(0);
  const [pos, setPos] = useState([]);
  const [startDate, setStartDate] = useState(development.startDate || '');
  const [targetCompletion, setTargetCompletion] = useState(
    development.targetCompletion || ''
  );
  const [dateError, setDateError] = useState('');

  useEffect(() => {
    setStartDate(development.startDate || '');
    setTargetCompletion(development.targetCompletion || '');
    setDateError('');
    setActiveTab('overview');
    setCvrView('register');
    setCvrPeriodKey(null);
  }, [development.id, development.startDate, development.targetCompletion]);

  useEffect(() => {
    if (!initialActiveTab && !initialCvrPeriodKey) return;
    if (initialActiveTab) setActiveTab(initialActiveTab);
    if (initialCvrPeriodKey) {
      setCvrPeriodKey(initialCvrPeriodKey);
      setCvrView('workspace');
    }
  }, [initialActiveTab, initialCvrPeriodKey]);

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
  }, [development.id, commercialRefresh, ledgerRefresh, cvrRefresh]);

  useEffect(() => {
    function refreshCommercial() {
      setCommercialRefresh((value) => value + 1);
    }

    window.addEventListener('focus', refreshCommercial);
    document.addEventListener('visibilitychange', refreshCommercial);
    const unsubscribe = subscribeCommercialChanged(refreshCommercial);

    return () => {
      window.removeEventListener('focus', refreshCommercial);
      document.removeEventListener('visibilitychange', refreshCommercial);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (['overview', 'packages', 'commercial'].includes(activeTab)) {
      setCommercialRefresh((value) => value + 1);
    }
  }, [activeTab]);

  const model = useMemo(
    () => buildDevelopmentWorkspaceModel(development, { pos }),
    [development, pos, plotRefresh, ledgerRefresh, cvrRefresh, commercialRefresh]
  );

  useEffect(() => {
    setActiveTab('overview');
  }, [development?.id]);

  if (!model) return null;

  function handlePlotsChanged() {
    setPlotRefresh((value) => value + 1);
    onPlotsChanged?.();
  }

  function handleLedgerChanged() {
    setLedgerRefresh((value) => value + 1);
    setCvrRefresh((value) => value + 1);
    setCommercialRefresh((value) => value + 1);
    onLedgerChanged?.();
  }

  function handleCvrChanged() {
    setCvrRefresh((value) => value + 1);
    onCvrChanged?.();
  }

  function saveProgrammeDates(nextStart, nextTarget) {
    if (nextStart && nextTarget && nextTarget < nextStart) {
      setDateError('Target completion must be on or after the start date.');
      return;
    }

    setDateError('');
    updateDevelopment(development.id, {
      startDate: nextStart,
      targetCompletion: nextTarget,
    });
    onDevelopmentChanged?.();
  }

  function handleStartDateChange(value) {
    setStartDate(value);
    saveProgrammeDates(value, targetCompletion);
  }

  function handleTargetDateChange(value) {
    setTargetCompletion(value);
    saveProgrammeDates(startDate, value);
  }

  return (
    <div className="dev-workspace">
      <POPageHeader
        eyebrow="Development Workspace"
        title={model.developmentName}
        lead={`Development ${model.jobNumber}${model.location ? ` · ${model.location}` : ''}`}
      />

      <div className="dev-workspace__meta">
        <StatusBadge status={model.statusMeta} />
        {model.client ? (
          <span className="dev-workspace__meta-item">Client: {model.client}</span>
        ) : null}
        <label className="dev-workspace__meta-item dev-workspace__meta-date">
          <span>Start</span>
          <input
            className="input dev-workspace__date-input"
            type="date"
            value={startDate}
            onChange={(event) => handleStartDateChange(event.target.value)}
          />
        </label>
        <label className="dev-workspace__meta-item dev-workspace__meta-date">
          <span>Target</span>
          <input
            className="input dev-workspace__date-input"
            type="date"
            value={targetCompletion}
            min={startDate || undefined}
            onChange={(event) => handleTargetDateChange(event.target.value)}
          />
        </label>
        {dateError ? (
          <span className="dev-workspace__meta-error" role="alert">
            {dateError}
          </span>
        ) : null}
      </div>

      <SummaryDashboard cards={model.summaryCards} />

      <nav className="po-package-tabs dev-workspace__tabs" aria-label="Development sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`po-package-tabs__tab${
              activeTab === tab.id ? ' po-package-tabs__tab--active' : ''
            }`}
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="dev-workspace__tab-panel">
        {activeTab === 'overview' ? <DevelopmentOverview model={model} /> : null}

        {activeTab === 'plot-master' ? (
          <PlotMaster
            developmentId={model.id}
            developmentName={model.developmentName}
            refreshToken={plotRefresh}
            onPlotsChanged={handlePlotsChanged}
          />
        ) : null}

        {activeTab === 'packages' ? <DevelopmentPackagesTab model={model} /> : null}

        {activeTab === 'commercial' ? <DevelopmentCommercialTab model={model} /> : null}

        {activeTab === 'ledger' ? (
          <PurchaseLedger
            development={development}
            refreshToken={ledgerRefresh}
            onLedgerChanged={handleLedgerChanged}
          />
        ) : null}

        {activeTab === 'cvr' ? (
          cvrView === 'workspace' && cvrPeriodKey ? (
            <CVRWorkspace
              development={development}
              periodKey={cvrPeriodKey}
              refreshToken={cvrRefresh}
              onCvrChanged={handleCvrChanged}
              onBackToRegister={() => {
                setCvrView('register');
              }}
              onPeriodChanged={handleCvrChanged}
            />
          ) : (
            <CVRRegister
              development={development}
              pos={pos}
              refreshToken={cvrRefresh}
              onOpenPeriod={(periodKey) => {
                setCvrPeriodKey(periodKey);
                setCvrView('workspace');
              }}
              onChanged={handleCvrChanged}
            />
          )
        ) : null}
      </div>

      <div className="dev-workspace__footer">
        <button
          type="button"
          className="dev-workspace__back"
          onClick={onBackToList}
        >
          Back to Developments
        </button>
      </div>
    </div>
  );
}
