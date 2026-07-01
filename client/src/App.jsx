import { useState, useEffect } from "react";
import POForm from "./components/POForm";
import POList from "./components/POList";
import POArchive from "./components/POArchive";
import PaymentCertificates from "./components/PaymentCertificates";
import Developments from "./components/Developments";
import BrandHeader from "./components/Brandheader";
import SetupAssistant, { dismissSetupAssistant, isSetupDismissed } from "./setup/SetupAssistant";
import { buildPoFormSeedFromSetup, loadSetupDraft } from "./setup/setupDraft";
import "./styles/brand.css";
import "./styles/po-module.css";

function shouldShowSetupAssistant() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("setup") === "1") return !isSetupDismissed();
  return false;
}

export default function App() {
  const [tab, setTab] = useState("form");
  const [showSetup, setShowSetup] = useState(shouldShowSetupAssistant);
  const [setupLaunchSeed, setSetupLaunchSeed] = useState(null);
  const [listFocusPo, setListFocusPo] = useState(null);
  const [packageNav, setPackageNav] = useState({
    orderKey: null,
    tab: 'overview',
  });

  useEffect(() => {
    if (!localStorage.getItem("userEmail")) {
      localStorage.setItem("userEmail", "accounts@example.co.uk");
    }
    if (!localStorage.getItem("userName")) {
      localStorage.setItem("userName", "Commercial Manager");
    }
  }, []);

  const exitSetup = () => setShowSetup(false);

  const handleLaunchPO = () => {
    dismissSetupAssistant();
    exitSetup();
    setSetupLaunchSeed(buildPoFormSeedFromSetup(loadSetupDraft()));
    setTab("form");
  };

  const handleTab = (nextTab) => {
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
      />
    );
  }

  return (
    <div id="app">
      <BrandHeader activeTab={tab} onTab={handleTab} />

      <main className="po-app-main">
        {tab === "developments" && (
          <div key="developments" className="po-page po-page-animate-in">
            <Developments />
          </div>
        )}
        {tab === "form" && (
          <div key="form" className="po-page po-page-animate-in">
            <POForm
              setupLaunchSeed={setupLaunchSeed}
              onClearSetupLaunchSeed={() => setSetupLaunchSeed(null)}
              onViewPurchaseOrders={handleViewPurchaseOrders}
              onReviewAndApprove={handleReviewAndApprove}
              onCreateAnotherPO={handleCreateAnotherPO}
              onCreateDevelopment={() => setTab("developments")}
            />
          </div>
        )}
        {tab === "list" && (
          <div key="list" className="po-page po-page-animate-in">
            <POList
              focusPoNumber={listFocusPo}
              onFocusHandled={() => setListFocusPo(null)}
              onCreateFirstPO={handleCreateFirstPO}
              onCreateDevelopment={() => setTab("developments")}
              onOpenPackage={handleOpenPackage}
            />
          </div>
        )}
        {tab === "archive" && (
          <div key="archive" className="po-page po-page-animate-in">
            <POArchive onOpenPackage={handleOpenPackage} />
          </div>
        )}
        {tab === "certificates" && (
          <div key="certificates" className="po-page po-page-animate-in">
            <PaymentCertificates
              initialOrderKey={packageNav.orderKey}
              initialTab={packageNav.tab}
              onInitialOrderHandled={() =>
                setPackageNav({ orderKey: null, tab: 'overview' })
              }
            />
          </div>
        )}
      </main>
    </div>
  );
}
