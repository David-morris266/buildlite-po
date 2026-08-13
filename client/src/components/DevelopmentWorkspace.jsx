import { useEffect, useMemo, useState, useCallback } from 'react';
import ApplicationPageHeader from './layout/ApplicationPageHeader';
import { listPOs } from '../api';
import { updateDevelopment, VERSION_CONFLICT_MESSAGE } from '../developments/developmentStore';
import { buildDevelopmentWorkspaceNavigation } from '../navigation/navigationBuilders';
import {
  CommercialWorkspace,
  StandardWorkspace,
} from './layout/WorkspaceShell';
import { subscribeCommercialChanged } from '../commercial/commercialEvents';
import { buildDevelopmentWorkspaceModel } from '../developments/developmentHelpers';
import {
  ensurePackagesReadyForDevelopment,
} from '../payments/packageStore';
import DevelopmentCommercialEvents from './DevelopmentCommercialEvents';
import DevelopmentOverview, {
  DevelopmentPackagesTab,
  SummaryDashboard,
} from './DevelopmentOverview';
import {
  buildDevelopmentCommercialEventPackageLaunch,
  createDevelopmentCommercialNavigationSnapshot,
} from '../commercialEvents/commercialEventDevelopmentRegister';
import PlotMaster from './PlotMaster';
import PurchaseLedger from './PurchaseLedger';
import CVRSummaryPage from './CVRSummaryPage';
import CVRRegister from './CVRRegister';
import CVRWorkspace from './CVRWorkspace';
import RevenueWorkspace from './RevenueWorkspace';
import SubcontractPackageWorkspace from './SubcontractPackageWorkspace';
import PackageWorkspaceNotFound from './PackageWorkspaceNotFound';
import POLoading from './POLoading';
import {
  createCommercialEventNavigationSnapshot,
  resolveLinkedCommercialEventNavigation,
} from '../commercialEvents/commercialEventNavigation';
import { useCommercialAssistantScope } from '../commercialAssistant/CommercialAssistantContext';
import { buildPoOrdersForDevelopment } from '../payments/packageIdentityMerge';
import { resolvePackageWorkspaceOrder } from '../payments/packageWorkspaceOrderResolver';
import {
  applyDevelopmentWorkspaceTabSelection,
  DEVELOPMENT_WORKSPACE_TABS,
} from '../developments/developmentWorkspaceTabNavigation';

const TABS = DEVELOPMENT_WORKSPACE_TABS;

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
  const [posLoadState, setPosLoadState] = useState('loading');
  const [serverPackages, setServerPackages] = useState(null);
  const [packagesLoadState, setPackagesLoadState] = useState('idle');
  const [packagesLoadError, setPackagesLoadError] = useState('');
  const [packageLaunch, setPackageLaunch] = useState(null);
  const [packageLaunchError, setPackageLaunchError] = useState('');
  const [stablePackageWorkspaceOrder, setStablePackageWorkspaceOrder] = useState(null);
  const [commercialNavigationStack, setCommercialNavigationStack] = useState([]);
  const [developmentCommercialTarget, setDevelopmentCommercialTarget] = useState(null);
  const [commercialRegisterError, setCommercialRegisterError] = useState('');
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
    setPos([]);
    setPosLoadState('loading');
    setPackageLaunch(null);
    setPackageLaunchError('');
    setServerPackages(null);
    setPackagesLoadState('idle');
    setPackagesLoadError('');
    setCommercialNavigationStack([]);
    setDevelopmentCommercialTarget(null);
    setCommercialRegisterError('');
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

    setPosLoadState('loading');
    listPOs()
      .then((data) => {
        if (cancelled) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        setPos(items);
      })
      .catch(() => {
        if (!cancelled) setPos([]);
      })
      .finally(() => {
        if (!cancelled) setPosLoadState('loaded');
      });

    return () => {
      cancelled = true;
    };
  }, [development.id, commercialRefresh, ledgerRefresh, cvrRefresh]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setPackagesLoadState('loading');
      setPackagesLoadError('');
      setServerPackages(null);

      try {
        const packages = await ensurePackagesReadyForDevelopment(development.id, { pos });
        if (cancelled) return;
        setServerPackages(packages);
        setPackagesLoadState('loaded');
      } catch (error) {
        if (cancelled) return;
        setServerPackages(null);
        setPackagesLoadState('error');
        setPackagesLoadError(
          error?.message || 'Failed to load packages from the server.'
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [development.id, pos, commercialRefresh]);

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
    () =>
      buildDevelopmentWorkspaceModel(development, {
        pos,
        serverPackages: packagesLoadState === 'loaded' ? serverPackages || [] : null,
      }),
    [
      development,
      pos,
      serverPackages,
      packagesLoadState,
      plotRefresh,
      ledgerRefresh,
      cvrRefresh,
      commercialRefresh,
    ]
  );

  const packageIdentityError =
    packagesLoadState === 'error' ? packagesLoadError : packageLaunchError;

  const handleAssistantNavigation = useCallback((resolution) => {
    if (!resolution?.launch) return;

    if (resolution.event?.id) {
      const snapshot = createDevelopmentCommercialNavigationSnapshot(resolution.event.id);
      if (snapshot) {
        setCommercialNavigationStack([snapshot]);
      }
    } else {
      setCommercialNavigationStack([]);
    }

    setCommercialRegisterError('');
    setPackageLaunchError('');
    setPackageLaunch(resolution.launch);
  }, []);

  useCommercialAssistantScope(
    {
      developmentId: development.id,
      packages: model?.packages || [],
      onNavigate: handleAssistantNavigation,
    },
    [development.id, model?.packages, handleAssistantNavigation],
    { enabled: !packageLaunch }
  );

  const poOrders = useMemo(
    () => buildPoOrdersForDevelopment(development.id, pos),
    [development.id, pos]
  );

  const packageWorkspaceResolution = useMemo(() => {
    if (!packageLaunch?.orderKey || packageLaunch?.identityError) return null;
    return resolvePackageWorkspaceOrder({
      orderKey: packageLaunch.orderKey,
      serverPackages: packagesLoadState === 'loaded' ? serverPackages || [] : [],
      poOrders,
      poLoading: posLoadState === 'loading',
      packagesLoading: packagesLoadState === 'loading',
    });
  }, [
    packageLaunch?.orderKey,
    packageLaunch?.identityError,
    serverPackages,
    poOrders,
    posLoadState,
    packagesLoadState,
  ]);

  const packageLaunchErrorMessage = useMemo(() => {
    if (!packageLaunch) return packageLaunchError;
    if (packageLaunch.identityError) return packageLaunch.identityError;
    if (packageLaunchError) return packageLaunchError;
    if (packageWorkspaceResolution?.status === 'incomplete') {
      return packageWorkspaceResolution.message;
    }
    return null;
  }, [packageLaunch, packageLaunchError, packageWorkspaceResolution]);

  useEffect(() => {
    if (packageWorkspaceResolution?.status === 'ready') {
      setStablePackageWorkspaceOrder(packageWorkspaceResolution.order);
    }
  }, [packageWorkspaceResolution]);

  useEffect(() => {
    if (!packageLaunch) {
      setStablePackageWorkspaceOrder(null);
    }
  }, [packageLaunch]);

  const activePackageWorkspaceOrder = useMemo(() => {
    if (packageWorkspaceResolution?.status === 'ready') {
      return packageWorkspaceResolution.order;
    }
    if (
      packageWorkspaceResolution?.status === 'loading' &&
      stablePackageWorkspaceOrder?.orderKey === packageLaunch?.orderKey
    ) {
      return stablePackageWorkspaceOrder;
    }
    return null;
  }, [
    packageWorkspaceResolution,
    stablePackageWorkspaceOrder,
    packageLaunch?.orderKey,
  ]);

  useEffect(() => {
    setActiveTab('overview');
    setPackageLaunch(null);
    setPackageLaunchError('');
    setCommercialNavigationStack([]);
  }, [development?.id]);

  function handleSelectWorkspaceTab(tabId) {
    const next = applyDevelopmentWorkspaceTabSelection(tabId);
    if (!next) return;

    setPackageLaunch(next.packageLaunch);
    setPackageLaunchError(next.packageLaunchError);
    setCommercialNavigationStack(next.commercialNavigationStack);
    setActiveTab(next.activeTab);
  }

  if (!model) {
    return (
      <StandardWorkspace>
        <div className="po-module-card po-empty-state">
          <p className="po-empty-state__message">
            Development workspace data is unavailable. Return to the development
            list and try again.
          </p>
          <button
            type="button"
            className="po-list-btn-secondary"
            onClick={onBackToList}
          >
            Back to Developments
          </button>
        </div>
      </StandardWorkspace>
    );
  }

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

  async function saveProgrammeDates(nextStart, nextTarget) {
    if (nextStart && nextTarget && nextTarget < nextStart) {
      setDateError('Target completion must be on or after the start date.');
      return;
    }

    setDateError('');
    try {
      await updateDevelopment(development.id, {
        startDate: nextStart,
        targetCompletion: nextTarget,
        version: development.version,
      });
      onDevelopmentChanged?.();
    } catch (error) {
      setDateError(
        error.code === 'VERSION_CONFLICT'
          ? VERSION_CONFLICT_MESSAGE
          : error.message || 'Could not save programme dates.'
      );
    }
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
    setCommercialNavigationStack([]);
    setDevelopmentCommercialTarget(null);
    setCommercialRegisterError('');
    setActiveTab('packages');
  }

  function handlePackageWorkspaceBack() {
    if (commercialNavigationStack.length > 0) {
      const previous = commercialNavigationStack[commercialNavigationStack.length - 1];
      setCommercialNavigationStack((stack) => stack.slice(0, -1));

      if (previous.kind === 'development-commercial') {
        setPackageLaunch(null);
        setPackageLaunchError('');
        setActiveTab('commercial');
        setDevelopmentCommercialTarget(previous.developmentCommercialTarget);
        return;
      }

      setPackageLaunch(previous.packageLaunch);
      setPackageLaunchError('');
      return;
    }

    handleBackToDevelopmentPackages();
  }

  function handleOpenPackageFromCommercialRegister(event) {
    if (!event) return;

    const result = buildDevelopmentCommercialEventPackageLaunch({
      event,
      packages: model?.packages || [],
      developmentId: development.id,
    });

    if (!result.ok) {
      setCommercialRegisterError(result.errors?.[0] || 'Unable to open package');
      return;
    }

    const snapshot = createDevelopmentCommercialNavigationSnapshot(event.id);
    if (snapshot) {
      setCommercialNavigationStack([snapshot]);
    }

    setCommercialRegisterError('');
    setPackageLaunchError('');
    setPackageLaunch(result.launch);
  }

  function handleNavigateToLinkedFromCommercialRegister(sourceEvent) {
    if (!sourceEvent) return;

    const navigation = resolveLinkedCommercialEventNavigation({
      developmentId: development.id,
      sourceEvent,
      currentPackageId: sourceEvent.packageId,
      packages: model?.packages || [],
    });

    if (!navigation.ok) {
      setCommercialRegisterError(
        navigation.errors?.[0] || 'Unable to open related commercial event'
      );
      return;
    }

    if (navigation.kind === 'same-package') {
      setCommercialRegisterError('');
      setDevelopmentCommercialTarget({
        eventId: navigation.linkedEvent.id,
        mode: 'view',
        navigationKey: `${navigation.linkedEvent.id}-${Date.now()}`,
      });
      return;
    }

    const snapshot = createDevelopmentCommercialNavigationSnapshot(sourceEvent.id);
    if (snapshot) {
      setCommercialNavigationStack([snapshot]);
    }

    setCommercialRegisterError('');
    setPackageLaunchError('');
    setPackageLaunch(navigation.launch);
  }

  function handleNavigateToLinkedCommercialEvent(sourceEvent) {
    if (!sourceEvent || !packageLaunch) return;

    const navigation = resolveLinkedCommercialEventNavigation({
      developmentId: development.id,
      sourceEvent,
      currentPackageId: packageLaunch.orderKey,
      packages: model?.packages || [],
    });

    if (!navigation.ok) {
      setPackageLaunchError(navigation.errors?.[0] || 'Unable to open related commercial event');
      return;
    }

    setPackageLaunchError('');

    if (navigation.kind === 'same-package') {
      setPackageLaunch({
        ...packageLaunch,
        initialTab: 'variations',
        commercialEventTarget: {
          eventId: navigation.linkedEvent.id,
          mode: 'view',
          navigationKey: `${navigation.linkedEvent.id}-${Date.now()}`,
        },
      });
      return;
    }

    const snapshot = createCommercialEventNavigationSnapshot(
      packageLaunch,
      sourceEvent.id
    );
    if (snapshot) {
      setCommercialNavigationStack((stack) => [...stack, snapshot]);
    }
    setPackageLaunch(navigation.launch);
  }

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

    if (
      !activePackageWorkspaceOrder &&
      (!packageWorkspaceResolution ||
        packageWorkspaceResolution.status === 'loading')
    ) {
      return (
        <WorkspaceShell>
          <div className="po-module-card">
            <POLoading message="Loading package commercial data…" />
            <div className="po-empty-state__actions">
              <button
                type="button"
                className="po-list-btn-secondary"
                onClick={handleBackToDevelopmentPackages}
              >
                Back to Packages
              </button>
            </div>
          </div>
        </WorkspaceShell>
      );
    }

    return (
      <WorkspaceShell>
        <SubcontractPackageWorkspace
          order={activePackageWorkspaceOrder}
          initialTab={packageLaunch.initialTab}
          navigationContext={packageLaunch}
          commercialEventTarget={packageLaunch.commercialEventTarget}
          certificateTarget={packageLaunch.certificateTarget}
          developmentName={model.developmentName}
          onBackToDevelopmentList={onBackToList}
          onBackToList={handlePackageWorkspaceBack}
          onNavigateToLinkedCommercialEvent={handleNavigateToLinkedCommercialEvent}
          packageLaunchError={packageLaunchError}
          assistantDevelopmentPackages={model?.packages || []}
          onAssistantNavigate={handleAssistantNavigation}
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
    onSelectTab: handleSelectWorkspaceTab,
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
            onClick={() => handleSelectWorkspaceTab(tab.id)}
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
            packageError={packageIdentityError}
            packagesLoading={packagesLoadState === 'loading'}
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
            packageError={packageIdentityError}
            packagesLoading={packagesLoadState === 'loading'}
          />
        ) : null}

        {activeTab === 'commercial' ? (
          <DevelopmentCommercialEvents
            model={model}
            commercialEventTarget={developmentCommercialTarget}
            onCommercialEventTargetHandled={() => setDevelopmentCommercialTarget(null)}
            onOpenPackage={handleOpenPackageFromCommercialRegister}
            onNavigateToLinkedCrossPackage={handleNavigateToLinkedFromCommercialRegister}
            registerError={commercialRegisterError}
            onRegisterError={setCommercialRegisterError}
          />
        ) : null}

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
