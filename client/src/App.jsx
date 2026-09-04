import { useEffect, useState } from 'react';
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
import SetupAssistant, { dismissSetupAssistant } from './setup/SetupAssistant';
import { buildPoFormSeedFromSetup, loadSetupDraft } from './setup/setupDraft';
import { getCommercialStructure } from './admin/commercialStructureStore';
import { useBuildLitePrincipal } from './auth/BuildLiteAuthProvider';
import { shouldEnterSetup } from './navigation/startupDestination';
import './styles/brand.css';
import './styles/po-module.css';

const HOME_VIEW = 'home';

function requestedEntryView() {
  const params = new URLSearchParams(window.location.search);
  return params.get('setup') === '1' ? 'setup' : HOME_VIEW;
}

export default function App() {
  const principal = useBuildLitePrincipal();
  const [tab, setTab] = useState(HOME_VIEW);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [setupLaunchSeed, setSetupLaunchSeed] = useState(null);
  const [listFocusPo, setListFocusPo] = useState(null);
  const [cvrNav, setCvrNav] = useState({ developmentId: null, periodKey: null });
  const [cvrRefresh, setCvrRefresh] = useState(0);
  const [adminDashboardReset, setAdminDashboardReset] = useState(0);
  const [navigationOrigin, setNavigationOrigin] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem('userEmail')) localStorage.setItem('userEmail', 'accounts@example.co.uk');
    if (!localStorage.getItem('userName')) localStorage.setItem('userName', 'Commercial Manager');
    getCommercialStructure();
  }, []);

  const showSetup = shouldEnterSetup({
    routeView: requestedEntryView(),
    tenantReadiness: principal?.tenantReadiness,
    setupDismissed,
  });

  const exitSetup = () => {
    dismissSetupAssistant();
    setSetupDismissed(true);
    setTab(HOME_VIEW);
  };

  const handleLaunchPO = (seed = null) => {
    dismissSetupAssistant();
    setSetupDismissed(true);
    setSetupLaunchSeed(seed || buildPoFormSeedFromSetup(loadSetupDraft()));
    setTab('form');
  };

  const handleOpenAdministration = () => {
    dismissSetupAssistant();
    setSetupDismissed(true);
    setTab('administration');
  };

  const handleOpenDevelopments = () => {
    dismissSetupAssistant();
    setSetupDismissed(true);
    setTab('developments');
  };

  const handleTab = (nextTab) => {
    if (nextTab === 'administration' && tab === 'administration') {
      setAdminDashboardReset((value) => value + 1);
    }
    if (tab === 'form' && nextTab !== 'form') setSetupLaunchSeed(null);
    setTab(nextTab);
  };

  const handleHomeNavigate = ({ view }) => {
    const tabByView = {
      home: 'home', administration: 'administration', cvrs: 'cvrs', developments: 'developments',
      'new-purchase-order': 'form', 'purchase-orders': 'list', archive: 'archive',
      'payment-approval': 'payment-approval', 'payment-release': 'payment-release',
    };
    handleTab(tabByView[view] || HOME_VIEW);
  };

  const handleViewPurchaseOrders = (poNumber) => {
    setListFocusPo(poNumber || null);
    setSetupLaunchSeed(null);
    setTab('list');
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
        onLaunchPO={handleLaunchPO} onOpenDevelopments={handleOpenDevelopments} /> : null}
      {tab === 'cvrs' ? <CommercialWorkspace><CVRPortfolio refreshToken={cvrRefresh}
        onOpenDevelopmentCvr={(developmentId) => {
          setNavigationOrigin({ label: 'CVR Portfolio', returnTab: 'cvrs' });
          setCvrNav({ developmentId, periodKey: null });
          setTab('developments');
        }}
        onOpenDevelopmentPeriod={(developmentId, periodKey) => {
          setNavigationOrigin({ label: 'CVR Portfolio', returnTab: 'cvrs' });
          setCvrNav({ developmentId, periodKey });
          setTab('developments');
        }} /></CommercialWorkspace> : null}
      {tab === 'developments' ? <Developments
        initialDevelopmentId={cvrNav.developmentId}
        initialWorkspaceTab={cvrNav.developmentId ? 'cvr' : null}
        initialCvrPeriodKey={cvrNav.periodKey}
        navigationOrigin={navigationOrigin ? {
          label: navigationOrigin.label,
          onReturn: () => { setTab(navigationOrigin.returnTab || 'cvrs'); setNavigationOrigin(null); },
        } : null}
        onInitialDevelopmentHandled={() => {
          setCvrNav({ developmentId: null, periodKey: null });
          setNavigationOrigin(null);
          setCvrRefresh((value) => value + 1);
        }} /> : null}
      {tab === 'form' ? <CommercialWorkspace><POForm setupLaunchSeed={setupLaunchSeed}
        onClearSetupLaunchSeed={() => setSetupLaunchSeed(null)} onViewPurchaseOrders={handleViewPurchaseOrders}
        onReviewAndApprove={handleViewPurchaseOrders} onCreateAnotherPO={() => setSetupLaunchSeed(null)}
        onCreateDevelopment={handleOpenDevelopments} onBack={() => setTab('list')} /></CommercialWorkspace> : null}
      {tab === 'list' ? <CommercialWorkspace><POList focusPoNumber={listFocusPo}
        onFocusHandled={() => setListFocusPo(null)} onCreateFirstPO={() => setTab('form')}
        onCreateDevelopment={handleOpenDevelopments} onOpenPackage={handleOpenDevelopments} /></CommercialWorkspace> : null}
      {tab === 'archive' ? <CommercialWorkspace><POArchive onOpenPackage={handleOpenDevelopments} /></CommercialWorkspace> : null}
      {tab === 'payment-approval' ? <CommercialWorkspace><PaymentApprovalRun /></CommercialWorkspace> : null}
      {tab === 'payment-release' ? <CommercialWorkspace><PaymentReleaseWorklist /></CommercialWorkspace> : null}
    </main>
  </div></CommercialAssistantProvider></NavigationProvider>;
}
