import { useState, useEffect } from "react";
import POForm from "./components/POForm";
import POList from "./components/POList";
import POArchive from "./components/POArchive";
import BrandHeader from "./components/Brandheader";
import SetupAssistant, { dismissSetupAssistant, isSetupDismissed } from "./setup/SetupAssistant";
import { buildPoFormSeedFromSetup, loadSetupDraft } from "./setup/setupDraft";
import "./styles/brand.css";

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

  const handleExploreBuildLite = () => {
    dismissSetupAssistant();
    exitSetup();
    setTab("list");
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

      <main style={{ padding: "16px", display: "grid", gap: "16px" }}>
        {tab === "form" && (
          <POForm
            setupLaunchSeed={setupLaunchSeed}
            onClearSetupLaunchSeed={() => setSetupLaunchSeed(null)}
            onViewPurchaseOrders={handleViewPurchaseOrders}
            onReviewAndApprove={handleReviewAndApprove}
            onCreateAnotherPO={handleCreateAnotherPO}
          />
        )}
        {tab === "list" && (
          <POList
            focusPoNumber={listFocusPo}
            onFocusHandled={() => setListFocusPo(null)}
          />
        )}
        {tab === "archive" && <POArchive />}
      </main>
    </div>
  );
}
