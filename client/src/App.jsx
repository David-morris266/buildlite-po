import { useEffect, useState } from "react";
import POForm from "./components/POForm";
import POList from "./components/POList";
import POArchive from "./components/POArchive";
import PaymentCertificates from "./components/PaymentCertificates";
import PaymentApprovalRun from "./components/PaymentApprovalRun";
import Developments from "./components/Developments";
import CVRPortfolio from "./components/CVRPortfolio";
import AdministrationModule from "./components/admin/AdministrationModule";
import BrandHeader from "./components/Brandheader";
import {
  CommercialAssistantProvider,
} from "./commercialAssistant/CommercialAssistantContext";
import CommercialAssistantDrawer from "./commercialAssistant/CommercialAssistantDrawer";
import {
  CommercialWorkspace,
} from "./components/layout/WorkspaceShell";
import { NavigationProvider } from "./navigation/NavigationContext";
import SetupAssistant, { dismissSetupAssistant, shouldShowSetupAssistant } from "./setup/SetupAssistant";
import { buildPoFormSeedFromSetup, loadSetupDraft } from "./setup/setupDraft";
import { getCommercialStructure } from "./admin/commercialStructureStore";
import "./styles/brand.css";
import "./styles/po-module.css";

function shouldShowSetupOnLaunch() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("setup") === "1") return true;
  return shouldShowSetupAssistant();
}

export default function App() {
  const [tab, setTab] = useState("form");
  const [showSetup, setShowSetup] = useState(shouldShowSetupOnLaunch);
  const [setupLaunchSeed, setSetupLaunchSeed] = useState(null);
  const [listFocusPo, setListFocusPo] = useState(null);
  const [packageNav, setPackageNav] = useState({
    orderKey: null,
    tab: 'overview',
  });
  const [cvrNav, setCvrNav] = useState({
    developmentId: null,
    periodKey: null,
  });
  const [cvrRefresh, setCvrRefresh] = useState(0);
  const [adminDashboardReset, setAdminDashboardReset] = useState(0);
  const [navigationOrigin, setNavigationOrigin] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem("userEmail")) {
      localStorage.setItem("userEmail", "accounts@example.co.uk");
    }
    if (!localStorage.getItem("userName")) {
      localStorage.setItem("userName", "Commercial Manager");
    }
    getCommercialStructure();
  }, []);

  const exitSetup = () => setShowSetup(false);

  const handleLaunchPO = (seed = null) => {
    dismissSetupAssistant();
    exitSetup();
    setSetupLaunchSeed(seed || buildPoFormSeedFromSetup(loadSetupDraft()));
    setTab("form");
  };

  const handleOpenAdministration = () => {
    dismissSetupAssistant();
    exitSetup();
    setTab("administration");
  };

  const handleOpenDevelopments = () => {
    dismissSetupAssistant();
    exitSetup();
    setTab("developments");
  };

  const handleTab = (nextTab) => {
    if (nextTab === "administration" && tab === "administration") {
      setAdminDashboardReset((value) => value + 1);
    }
    if (tab === "form" && nextTab !== "form") {
      setSetupLaunchSeed(null);
    }
    setTab(nextTab);
  };

  const handleViewPurchaseOrders = (poNumber) => {
    setListFocusPo(poNumber || null);
    setSetupLaunchSeed(null);
    setTab("list");
  };

  const handleReviewAndApprove = (poNumber) => {
    setListFocusPo(poNumber || null);
    setSetupLaunchSeed(null);
    setTab("list");
  };

  const handleCreateAnotherPO = () => {
    setSetupLaunchSeed(null);
  };

  const handleCreateFirstPO = () => {
    setSetupLaunchSeed(null);
    setTab("form");
  };

  const handleExploreBuildLite = () => {
    dismissSetupAssistant();
    exitSetup();
    setTab("list");
  };

  const handleOpenPackage = (orderKey, tab = "overview") => {
    setPackageNav({
      orderKey: orderKey || null,
      tab: tab || "overview",
    });
    setTab("certificates");
  };

  if (showSetup) {
    return (
      <SetupAssistant
        onExit={exitSetup}
        onLaunchPO={handleLaunchPO}
        onExplore={handleExploreBuildLite}
        onOpenAdministration={handleOpenAdministration}
        onOpenDevelopments={handleOpenDevelopments}
      />
    );
  }

  return (
    <NavigationProvider>
    <CommercialAssistantProvider>
    <div id="app">
      <BrandHeader
        activeTab={tab}
        onTab={handleTab}
      />

      <CommercialAssistantDrawer />

      <main className="po-app-main">
        {tab === "administration" && (
          <AdministrationModule
            dashboardResetToken={adminDashboardReset}
            onLaunchPO={handleLaunchPO}
            onOpenDevelopments={handleOpenDevelopments}
          />
        )}
        {tab === "cvrs" && (
          <CommercialWorkspace>
            <CVRPortfolio
              refreshToken={cvrRefresh}
              onOpenDevelopmentCvr={(developmentId) => {
                setNavigationOrigin({ label: 'CVR Portfolio', returnTab: 'cvrs' });
                setCvrNav({ developmentId, periodKey: null });
                setTab("developments");
              }}
              onOpenDevelopmentPeriod={(developmentId, periodKey) => {
                setNavigationOrigin({ label: 'CVR Portfolio', returnTab: 'cvrs' });
                setCvrNav({ developmentId, periodKey });
                setTab("developments");
              }}
            />
          </CommercialWorkspace>
        )}
        {tab === "developments" && (
          <Developments
              initialDevelopmentId={cvrNav.developmentId}
              initialWorkspaceTab={cvrNav.periodKey ? "cvr" : cvrNav.developmentId ? "cvr" : null}
              initialCvrPeriodKey={cvrNav.periodKey}
              navigationOrigin={navigationOrigin ? {
                label: navigationOrigin.label,
                onReturn: () => {
                  setTab(navigationOrigin.returnTab || 'cvrs');
                  setNavigationOrigin(null);
                },
              } : null}
              onOpenPackage={handleOpenPackage}
              onInitialDevelopmentHandled={() => {
                setCvrNav({ developmentId: null, periodKey: null });
                setNavigationOrigin(null);
                setCvrRefresh((value) => value + 1);
              }}
            />
        )}
        {tab === "form" && (
          <CommercialWorkspace>
            <POForm
              setupLaunchSeed={setupLaunchSeed}
              onClearSetupLaunchSeed={() => setSetupLaunchSeed(null)}
              onViewPurchaseOrders={handleViewPurchaseOrders}
              onReviewAndApprove={handleReviewAndApprove}
              onCreateAnotherPO={handleCreateAnotherPO}
              onCreateDevelopment={() => setTab("developments")}
              onBack={() => setTab("list")}
            />
          </CommercialWorkspace>
        )}
        {tab === "list" && (
          <CommercialWorkspace>
            <POList
              focusPoNumber={listFocusPo}
              onFocusHandled={() => setListFocusPo(null)}
              onCreateFirstPO={handleCreateFirstPO}
              onCreateDevelopment={() => setTab("developments")}
              onOpenPackage={handleOpenPackage}
            />
          </CommercialWorkspace>
        )}
        {tab === "archive" && (
          <CommercialWorkspace>
            <POArchive onOpenPackage={handleOpenPackage} />
          </CommercialWorkspace>
        )}
        {tab === "certificates" && (
          <CommercialWorkspace>
            <PaymentCertificates
              initialOrderKey={packageNav.orderKey}
              initialTab={packageNav.tab}
              onInitialOrderHandled={() =>
                setPackageNav({ orderKey: null, tab: 'overview' })
              }
            />
          </CommercialWorkspace>
        )}
        {tab === "payment-approval" && (
          <CommercialWorkspace><PaymentApprovalRun /></CommercialWorkspace>
        )}
      </main>
    </div>
    </CommercialAssistantProvider>
    </NavigationProvider>
  );
}
