import { useEffect, useMemo, useState } from 'react';
import ApplicationPageHeader from './layout/ApplicationPageHeader';
import { listPOs } from '../api';
import { updateDevelopment } from '../developments/developmentStore';
import { buildDevelopmentWorkspaceNavigation } from '../navigation/navigationBuilders';
import {
  CommercialWorkspace,
  StandardWorkspace,
} from './layout/WorkspaceShell';
import { subscribeCommercialChanged } from '../commercial/commercialEvents';
import { buildDevelopmentWorkspaceModel } from '../developments/developmentHelpers';
import DevelopmentOverview, {
  DevelopmentCommercialTab,
  DevelopmentPackagesTab,
  SummaryDashboard,
} from './DevelopmentOverview';
import PlotMaster from './PlotMaster';
import PurchaseLedger from './PurchaseLedger';
import CVRSummaryPage from './CVRSummaryPage';
import CVRRegister from './CVRRegister';
import CVRWorkspace from './CVRWorkspace';
import RevenueWorkspace from './RevenueWorkspace';
import SubcontractPackageWorkspace from './SubcontractPackageWorkspace';
import PackageWorkspaceNotFound from './PackageWorkspaceNotFound';
import {
  getPackageLaunchErrorMessage,
  resolvePackageOrderFromList,
} from '../payments/packageWorkspaceLaunch';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'plot-master', label: 'Plot Master' },
  { id: 'packages', label: 'Packages' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'revenue', label: 'Revenue' },
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
  navigationOrigin = null,
  onBackToList,
  onPlotsChanged,
  onLedgerChanged,
  onCvrChanged,
  onDevelopmentChanged,
  initialActiveTab = null,
  initialCvrPeriodKey = null,
  onOpenPackage,
}) {
  const [activeTab, setActiveTab] = useState(initialActiveTab || 'overview');
  const [cvrView, setCvrView] = useState(initialCvrPeriodKey ? 'summary' : 'register');
  const [cvrPeriodKey, setCvrPeriodKey] = useState(initialCvrPeriodKey);
  const [cvrFocusCostCodeKey, setCvrFocusCostCodeKey] = useState(null);
  const [cvrHeadFilter, setCvrHeadFilter] = useState(null);
  const [plotRefresh, setPlotRefresh] = useState(0);
  const [ledgerRefresh, setLedgerRefresh] = useState(0);
  const [cvrRefresh, setCvrRefresh] = useState(0);
  const [commercialRefresh, setCommercialRefresh] = useState(0);
  const [revenueRefresh, setRevenueRefresh] = useState(0);
  const [focusPlotId, setFocusPlotId] = useState(null);
  const [cvrRegisterAction, setCvrRegisterAction] = useState(null);
  const [pos, setPos] = useState([]);
  const [packageLaunch, setPackageLaunch] = useState(null);
  const [packageLaunchError, setPackageLaunchError] = useState('');
  const [startDate, setStartDate] = useState(development.startDate || '');
  const [targetCompletion, setTargetCompletion] = useState(
    development.targetCompletion || ''
  );
  const [dateError, setDateError] = useState('');

  useEffect(() => {
    setStartDate(development.startDate || '');
    setTargetCompletion(development.targetCompletion || '');
    setDateError('');
    setActiveTab(initialActiveTab || 'overview');
    if (!initialCvrPeriodKey) {
      setCvrView('register');
      setCvrPeriodKey(null);
    }
    setCvrFocusCostCodeKey(null);
    setCvrHeadFilter(null);
    setFocusPlotId(null);
    setPackageLaunch(null);
    setPackageLaunchError('');
  }, [development.id, development.startDate, development.targetCompletion, initialActiveTab, initialCvrPeriodKey]);

  useEffect(() => {
    if (!initialActiveTab && !initialCvrPeriodKey) return;
    if (initialActiveTab) setActiveTab(initialActiveTab);
    if (initialCvrPeriodKey) {
      setCvrPeriodKey(initialCvrPeriodKey);
      setCvrView('summary');
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
    if (activeTab === 'revenue') {
      setRevenueRefresh((value) => value + 1);
    }
  }, [activeTab]);

  const model = useMemo(
    () => buildDevelopmentWorkspaceModel(development, { pos }),
    [development, pos, plotRefresh, ledgerRefresh, cvrRefresh, commercialRefresh]
  );

  const activePackageOrder = useMemo(
    () => resolvePackageOrderFromList(model?.packages, packageLaunch?.orderKey),
    [model?.packages, packageLaunch?.orderKey]
  );

  useEffect(() => {
    setActiveTab('overview');
    setPackageLaunch(null);
    setPackageLaunchError('');
  }, [development?.id]);

  if (!model) return null;

  function handlePlotsChanged() {
    setPlotRefresh((value) => value + 1);
    setRevenueRefresh((value) => value + 1);
    onPlotsChanged?.();
  }

  function handleRevenueChanged() {
    setRevenueRefresh((value) => value + 1);
    setPlotRefresh((value) => value + 1);
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

  function resetCvrToRegister() {
    setCvrView('register');
    setCvrPeriodKey(null);
    setCvrFocusCostCodeKey(null);
    setCvrHeadFilter(null);
  }

  function handleOpenPackageFromDevelopment(_orderKey, launchContext) {
    if (!launchContext) return;

    if (launchContext.identityError) {
      setPackageLaunchError(launchContext.identityError);
      setPackageLaunch(null);
      setActiveTab('packages');
      return;
    }

    setPackageLaunchError('');
    setPackageLaunch(launchContext);
    setActiveTab('packages');
  }

  function handleBackToDevelopmentPackages() {
    setPackageLaunch(null);
    setPackageLaunchError('');
    setActiveTab('packages');
  }

  const packageLaunchErrorMessage = packageLaunch
    ? getPackageLaunchErrorMessage(packageLaunch, activePackageOrder)
    : packageLaunchError;

  const isCvrPeriodOpen =
    activeTab === 'cvr' && Boolean(cvrPeriodKey) && cvrView !== 'register';
  const WorkspaceShell =
    activeTab === 'cvr' || activeTab === 'ledger' || activeTab === 'revenue'
      ? CommercialWorkspace
      : StandardWorkspace;

  if (packageLaunch) {
    if (packageLaunchErrorMessage) {
      return (
        <WorkspaceShell>
          <PackageWorkspaceNotFound
            message={packageLaunchErrorMessage}
            onBack={handleBackToDevelopmentPackages}
            breadcrumbs={[
              { label: 'Developments', onClick: onBackToList },
              { label: model?.developmentName || 'Development' },
              { label: 'Packages' },
            ]}
            title="Package unavailable"
          />
        </WorkspaceShell>
      );
    }

    return (
      <WorkspaceShell>
        <SubcontractPackageWorkspace
          order={activePackageOrder}
          initialTab={packageLaunch.initialTab}
          navigationContext={packageLaunch}
          developmentName={model.developmentName}
          onBackToDevelopmentList={onBackToList}
          onBackToList={handleBackToDevelopmentPackages}
        />
      </WorkspaceShell>
    );
  }

  const workspaceNavigation = buildDevelopmentWorkspaceNavigation({
    developmentName: model.developmentName,
    activeTab,
    cvrView,
    periodKey: cvrPeriodKey,
    origin: navigationOrigin,
    onBackToList,
    onSelectTab: setActiveTab,
    onBackToCvrRegister: resetCvrToRegister,
    onBackToCvrSummary: () => {
      setCvrView('summary');
      setCvrFocusCostCodeKey(null);
      setCvrHeadFilter(null);
    },
  });

  return (
    <WorkspaceShell>
      <div
        className={`dev-workspace${activeTab === 'cvr' ? ' dev-workspace--cvr' : ''}${
          isCvrPeriodOpen ? ' dev-workspace--cvr-worksheet' : ''
        }`}
      >
      {!isCvrPeriodOpen ? (
        <ApplicationPageHeader
          breadcrumbs={workspaceNavigation.breadcrumbs}
          title={workspaceNavigation.title}
          lead={`Development ${model.jobNumber}${model.location ? ` · ${model.location}` : ''}`}
          onBack={workspaceNavigation.onBack}
          actions={
            activeTab === 'cvr' && cvrView === 'register' ? cvrRegisterAction : null
          }
        />
      ) : null}

      {!isCvrPeriodOpen ? (
        <div className="dev-workspace-identity po-module-card">
          <div className="dev-workspace-identity__badge">
            <StatusBadge status={model.statusMeta} />
          </div>
          <dl className="dev-workspace-identity__grid">
            <div className="dev-workspace-identity__item">
              <dt>Development</dt>
              <dd>{model.jobNumber}</dd>
            </div>
            {model.client ? (
              <div className="dev-workspace-identity__item">
                <dt>Client</dt>
                <dd>{model.client}</dd>
              </div>
            ) : null}
            <div className="dev-workspace-identity__item dev-workspace-identity__item--date">
              <dt>Start</dt>
              <dd>
                <input
                  className="input dev-workspace-identity__date-input"
                  type="date"
                  value={startDate}
                  onChange={(event) => handleStartDateChange(event.target.value)}
                  aria-label="Start date"
                />
              </dd>
            </div>
            <div className="dev-workspace-identity__item dev-workspace-identity__item--date">
              <dt>Target</dt>
              <dd>
                <input
                  className="input dev-workspace-identity__date-input"
                  type="date"
                  value={targetCompletion}
                  min={startDate || undefined}
                  onChange={(event) => handleTargetDateChange(event.target.value)}
                  aria-label="Target completion date"
                />
              </dd>
            </div>
          </dl>
          {dateError ? (
            <p className="dev-workspace-identity__error" role="alert">
              {dateError}
            </p>
          ) : null}
        </div>
      ) : null}

      {activeTab !== 'cvr' && activeTab !== 'revenue' && !isCvrPeriodOpen ? (
        <SummaryDashboard cards={model.summaryCards} />
      ) : null}

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
        {activeTab === 'overview' ? (
          <DevelopmentOverview
            model={model}
            onOpenPackage={handleOpenPackageFromDevelopment}
            packageError={packageLaunchError}
          />
        ) : null}

        {activeTab === 'plot-master' ? (
          <PlotMaster
            developmentId={model.id}
            developmentName={model.developmentName}
            refreshToken={plotRefresh}
            initialPlotId={focusPlotId}
            onFocusPlotHandled={() => setFocusPlotId(null)}
            onPlotsChanged={handlePlotsChanged}
          />
        ) : null}

        {activeTab === 'packages' ? (
          <DevelopmentPackagesTab
            model={model}
            onOpenPackage={handleOpenPackageFromDevelopment}
            packageError={packageLaunchError}
          />
        ) : null}

        {activeTab === 'commercial' ? <DevelopmentCommercialTab model={model} /> : null}

        {activeTab === 'ledger' ? (
          <PurchaseLedger
            development={development}
            refreshToken={ledgerRefresh}
            onLedgerChanged={handleLedgerChanged}
          />
        ) : null}

        {activeTab === 'revenue' ? (
          <RevenueWorkspace
            developmentId={model.id}
            refreshToken={revenueRefresh}
            onRevenueChanged={handleRevenueChanged}
          />
        ) : null}

        {activeTab === 'cvr' ? (
          cvrView === 'worksheet' && cvrPeriodKey ? (
            <CVRWorkspace
              development={development}
              periodKey={cvrPeriodKey}
              refreshToken={cvrRefresh}
              pageNavigation={workspaceNavigation}
              onCvrChanged={handleCvrChanged}
              onBackToSummary={() => {
                setCvrView('summary');
                setCvrFocusCostCodeKey(null);
                setCvrHeadFilter(null);
              }}
              onPeriodChanged={handleCvrChanged}
              initialCostCodeKey={cvrFocusCostCodeKey}
              headFilter={cvrHeadFilter}
              familyFilter={cvrHeadFilter}
              onClearHeadFilter={() => setCvrHeadFilter(null)}
              onClearFamilyFilter={() => setCvrHeadFilter(null)}
            />
          ) : cvrView === 'summary' && cvrPeriodKey ? (
            <CVRSummaryPage
              development={development}
              periodKey={cvrPeriodKey}
              refreshToken={cvrRefresh}
              pageNavigation={workspaceNavigation}
              onContinueToCvr={() => setCvrView('worksheet')}
              onOpenWorksheetForHead={(head) => setCvrHeadFilter(head)}
              onOpenWorksheetForFamily={(head) => setCvrHeadFilter(head)}
              onBackToRegister={() => {
                setCvrView('register');
                setCvrPeriodKey(null);
                setCvrFocusCostCodeKey(null);
                setCvrHeadFilter(null);
              }}
              onOpenPackage={onOpenPackage}
              onPeriodChanged={handleCvrChanged}
              initialCostCodeKey={cvrFocusCostCodeKey}
            />
          ) : (
            <CVRRegister
              development={development}
              pos={pos}
              refreshToken={cvrRefresh}
              onPrimaryActionChange={setCvrRegisterAction}
              onOpenPeriod={(periodKey) => {
                setCvrPeriodKey(periodKey);
                setCvrView('summary');
                setCvrFocusCostCodeKey(null);
                setCvrHeadFilter(null);
              }}
              onChanged={handleCvrChanged}
            />
          )
        ) : null}
      </div>
    </div>
    </WorkspaceShell>
  );
}
