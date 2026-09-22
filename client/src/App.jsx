import { useCallback, useEffect, useRef, useState } from 'react';
import POForm from './components/POForm';
import POList from './components/POList';
import POArchive from './components/POArchive';
import PaymentApprovalRun from './components/PaymentApprovalRun';
import PaymentReleaseWorklist from './components/PaymentReleaseWorklist';
import Developments from './components/Developments';
import CVRPortfolio from './components/CVRPortfolio';
import AdministrationModule from './components/admin/AdministrationModule';
import BrandHeader from './components/Brandheader';
import BuildLiteHome from './components/BuildLiteHome';
import { CommercialAssistantProvider } from './commercialAssistant/CommercialAssistantContext';
import CommercialAssistantDrawer from './commercialAssistant/CommercialAssistantDrawer';
import { CommercialWorkspace } from './components/layout/WorkspaceShell';
import { NavigationProvider } from './navigation/NavigationContext';
import { UnsavedChangesProvider } from './navigation/UnsavedChangesProvider.jsx';
import { useOptionalUnsavedChanges } from './navigation/UnsavedChangesContext.js';
import SetupAssistant, { dismissSetupAssistant } from './setup/SetupAssistant';
import { buildPoFormSeedFromSetup, loadSetupDraft } from './setup/setupDraft';
import { useBuildLitePrincipal } from './auth/BuildLiteAuthProvider';
import { shouldEnterSetup } from './navigation/startupDestination';
import { parseSubcontractOrderKey } from './payments/packageKeyMigration';
import {
  homeApplicationRoute,
  parseApplicationRoute,
  writeApplicationRoute,
} from './navigation/applicationRoute';
import './styles/brand.css';
import './styles/po-module.css';

const HOME_VIEW = 'home';

function ApplicationContent() {
  const principal = useBuildLitePrincipal();
  const unsavedChanges = useOptionalUnsavedChanges();
  const [initialRoute] = useState(() => parseApplicationRoute());
  const currentRouteRef = useRef(initialRoute);
  const [tab, setTab] = useState(
    initialRoute.view === 'setup' ? HOME_VIEW : initialRoute.view
  );
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [setupLaunchSeed, setSetupLaunchSeed] = useState(null);
  const [listFocusPo, setListFocusPo] = useState(null);
  const [cvrNav, setCvrNav] = useState({
    developmentId: initialRoute.developmentId,
    periodKey: initialRoute.periodKey,
    workspaceTab: initialRoute.workspaceTab,
    packageKey: initialRoute.packageKey,
    packageTab: initialRoute.packageTab,
    plotMasterView: initialRoute.plotMasterView,
  });
  const [cvrRefresh, setCvrRefresh] = useState(0);
  const [adminDashboardReset, setAdminDashboardReset] = useState(0);
  const [adminLaunch, setAdminLaunch] = useState(
    initialRoute.administrationSection
      ? { section: initialRoute.administrationSection, returnDevelopment: null }
      : null
  );
  const [navigationOrigin, setNavigationOrigin] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem('userEmail')) localStorage.setItem('userEmail', 'accounts@example.co.uk');
    if (!localStorage.getItem('userName')) localStorage.setItem('userName', 'Commercial Manager');
  }, []);

  const applyCanonicalRoute = useCallback((route) => {
    const next = route || homeApplicationRoute();
    currentRouteRef.current = next;
    setTab(next.view === 'setup' ? HOME_VIEW : next.view);
    setAdminLaunch(next.view === 'administration' && next.administrationSection
      ? {
          section: next.administrationSection,
          returnDevelopment: next.returnDevelopment || null,
        }
      : null);
    setCvrNav({
      developmentId: next.developmentId,
      periodKey: next.periodKey,
      workspaceTab: next.workspaceTab,
      packageKey: next.packageKey,
      packageTab: next.packageTab,
      plotMasterView: next.plotMasterView,
    });
  }, []);

  useEffect(() => {
    const restoreFromHistory = () => {
      const requestedRoute = parseApplicationRoute();
      if (!unsavedChanges?.isNavigationBlocked?.()) {
        applyCanonicalRoute(requestedRoute);
        return;
      }
      writeApplicationRoute(currentRouteRef.current, { replace: true });
      unsavedChanges.requestNavigation(() => {
        writeApplicationRoute(requestedRoute);
        applyCanonicalRoute(requestedRoute);
      });
    };
    window.addEventListener('popstate', restoreFromHistory);
    return () => window.removeEventListener('popstate', restoreFromHistory);
  }, [applyCanonicalRoute, unsavedChanges]);

  const navigateCanonical = useCallback((route, options) => {
    writeApplicationRoute(route, options);
    applyCanonicalRoute(route);
  }, [applyCanonicalRoute]);

  const writeDevelopmentRoute = useCallback((next, options) => {
    const route = {
      ...homeApplicationRoute(),
      view: 'developments',
      ...next,
    };
    currentRouteRef.current = route;
    writeApplicationRoute(route, options);
  }, []);

  const writeAdministrationRoute = useCallback((administrationSection, options) => {
    const route = {
      ...homeApplicationRoute(),
      view: 'administration',
      administrationSection,
    };
    currentRouteRef.current = route;
    writeApplicationRoute(route, options);
  }, []);

  const showSetup = shouldEnterSetup({
    routeView: parseApplicationRoute().view,
    tenantReadiness: principal?.tenantReadiness,
    setupDismissed,
  });

  const exitSetup = () => {
    dismissSetupAssistant();
    setSetupDismissed(true);
    navigateCanonical(homeApplicationRoute());
  };

  const handleLaunchPO = (seed = null) => {
    dismissSetupAssistant();
    setSetupDismissed(true);
    setSetupLaunchSeed(seed || buildPoFormSeedFromSetup(loadSetupDraft()));
    navigateCanonical({ ...homeApplicationRoute(), view: 'form' });
  };

  const handleOpenAdministration = () => {
    dismissSetupAssistant();
    setSetupDismissed(true);
    navigateCanonical({ ...homeApplicationRoute(), view: 'administration' });
  };

  const handleOpenDevelopments = () => {
    dismissSetupAssistant();
    setSetupDismissed(true);
    navigateCanonical({ ...homeApplicationRoute(), view: 'developments' });
  };

  const handleOpenPackage = (orderKey) => {
    const identity = parseSubcontractOrderKey(orderKey);
    if (!identity?.developmentId) {
      handleOpenDevelopments();
      return;
    }
    navigateCanonical({
      ...homeApplicationRoute(),
      view: 'developments',
      developmentId: identity.developmentId,
      workspaceTab: 'packages',
      packageKey: orderKey,
      packageTab: 'overview',
    });
  };

  const handleTab = (nextTab) => {
    if (nextTab === 'administration' && tab === 'administration') {
      setAdminDashboardReset((value) => value + 1);
    }
    if (tab === 'form' && nextTab !== 'form') setSetupLaunchSeed(null);
    if (nextTab === 'administration') setAdminLaunch(null);
    navigateCanonical({ ...homeApplicationRoute(), view: nextTab });
  };

  const handleHomeNavigate = ({ view, section = null, returnDevelopment = null }) => {
    const tabByView = {
      home: 'home', administration: 'administration', cvrs: 'cvrs', developments: 'developments',
      'new-purchase-order': 'form', 'purchase-orders': 'list', archive: 'archive',
      'payment-approval': 'payment-approval', 'payment-release': 'payment-release',
    };
    if (view === 'administration') {
      setAdminLaunch({ section: section || 'landing', returnDevelopment });
      navigateCanonical({
        ...homeApplicationRoute(),
        view: 'administration',
        administrationSection: section || 'landing',
        returnDevelopment,
      });
      return;
    }
    handleTab(tabByView[view] || HOME_VIEW);
  };

  const handleViewPurchaseOrders = (poNumber) => {
    setListFocusPo(poNumber || null);
    setSetupLaunchSeed(null);
    navigateCanonical({ ...homeApplicationRoute(), view: 'list' });
  };

  if (showSetup) {
    return <SetupAssistant onExit={exitSetup} onLaunchPO={handleLaunchPO}
      onExplore={exitSetup} onOpenAdministration={handleOpenAdministration}
      onOpenDevelopments={handleOpenDevelopments} />;
  }

  return <NavigationProvider><CommercialAssistantProvider><div id="app">
    <BrandHeader activeTab={tab} onTab={handleTab} />
    <CommercialAssistantDrawer />
    <main className="po-app-main">
      {tab === 'home' ? <CommercialWorkspace><BuildLiteHome onNavigate={handleHomeNavigate} /></CommercialWorkspace> : null}
      {tab === 'administration' ? <AdministrationModule dashboardResetToken={adminDashboardReset}
        initialView={adminLaunch?.section} returnDevelopment={adminLaunch?.returnDevelopment}
        onViewChange={(administrationSection) => writeAdministrationRoute(administrationSection)}
        onViewReplace={(administrationSection) => writeAdministrationRoute(administrationSection, { replace: true })}
        onReturnToDevelopment={(target) => {
          setAdminLaunch(null);
          setCvrNav({ developmentId: target.id, periodKey: null, workspaceTab: 'overview' });
          navigateCanonical({
            ...homeApplicationRoute(), view: 'developments', developmentId: target.id,
            workspaceTab: 'overview',
          });
        }} onLaunchPO={handleLaunchPO} onOpenDevelopments={handleOpenDevelopments} /> : null}
      {tab === 'cvrs' ? <CommercialWorkspace><CVRPortfolio refreshToken={cvrRefresh}
        onOpenDevelopmentCvr={(developmentId) => {
          setNavigationOrigin({ label: 'CVR Portfolio', returnTab: 'cvrs' });
          setCvrNav({ developmentId, periodKey: null, workspaceTab: 'cvr' });
          navigateCanonical({
            ...homeApplicationRoute(), view: 'developments', developmentId,
            workspaceTab: 'cvr',
          });
        }}
        onOpenDevelopmentPeriod={(developmentId, periodKey) => {
          setNavigationOrigin({ label: 'CVR Portfolio', returnTab: 'cvrs' });
          setCvrNav({ developmentId, periodKey, workspaceTab: 'cvr' });
          navigateCanonical({
            ...homeApplicationRoute(), view: 'developments', developmentId,
            periodKey, workspaceTab: 'cvr',
          });
        }} /></CommercialWorkspace> : null}
      {tab === 'developments' ? <Developments
        initialDevelopmentId={cvrNav.developmentId}
          initialWorkspaceTab={cvrNav.workspaceTab || (cvrNav.developmentId ? 'cvr' : null)}
          initialPlotMasterView={cvrNav.plotMasterView}
        initialCvrPeriodKey={cvrNav.periodKey}
        initialPackageKey={cvrNav.packageKey}
        initialPackageTab={cvrNav.packageTab}
        navigationOrigin={navigationOrigin ? {
          label: navigationOrigin.label,
          onReturn: () => {
            navigateCanonical({ ...homeApplicationRoute(), view: navigationOrigin.returnTab || 'cvrs' });
            setNavigationOrigin(null);
          },
        } : null}
        onInitialDevelopmentHandled={() => {
          setNavigationOrigin(null);
          setCvrRefresh((value) => value + 1);
        }}
        onRouteChange={(next) => writeDevelopmentRoute(next)}
        onRouteReplace={(next) => writeDevelopmentRoute(next, { replace: true })}
        onNavigate={handleHomeNavigate} /> : null}
      {tab === 'form' ? <CommercialWorkspace><POForm setupLaunchSeed={setupLaunchSeed}
        onClearSetupLaunchSeed={() => setSetupLaunchSeed(null)} onViewPurchaseOrders={handleViewPurchaseOrders}
        onReviewAndApprove={handleViewPurchaseOrders} onCreateAnotherPO={() => setSetupLaunchSeed(null)}
        onCreateDevelopment={handleOpenDevelopments} onBack={() => navigateCanonical({ ...homeApplicationRoute(), view: 'list' })} /></CommercialWorkspace> : null}
      {tab === 'list' ? <CommercialWorkspace><POList focusPoNumber={listFocusPo}
        onFocusHandled={() => setListFocusPo(null)} onCreateFirstPO={() => navigateCanonical({ ...homeApplicationRoute(), view: 'form' })}
        onCreateDevelopment={handleOpenDevelopments} onOpenPackage={handleOpenPackage} /></CommercialWorkspace> : null}
      {tab === 'archive' ? <CommercialWorkspace><POArchive onOpenPackage={handleOpenPackage} /></CommercialWorkspace> : null}
      {tab === 'payment-approval' ? <CommercialWorkspace><PaymentApprovalRun /></CommercialWorkspace> : null}
      {tab === 'payment-release' ? <CommercialWorkspace><PaymentReleaseWorklist /></CommercialWorkspace> : null}
    </main>
  </div></CommercialAssistantProvider></NavigationProvider>;
}

export default function App() {
  return <UnsavedChangesProvider><ApplicationContent /></UnsavedChangesProvider>;
}
