import { useState, useEffect } from "react";
import POForm from "./components/POForm";
import POList from "./components/POList";
import POArchive from "./components/POArchive";
import BrandHeader from "./components/Brandheader";
import SetupAssistant, { dismissSetupAssistant, isSetupDismissed } from "./setup/SetupAssistant";
import "./styles/brand.css";

function shouldShowSetupAssistant() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("setup") === "1") return !isSetupDismissed();
  return false;
}

export default function App() {
  const [tab, setTab] = useState("form");
  const [showSetup, setShowSetup] = useState(shouldShowSetupAssistant);
  const [applySetupDraft, setApplySetupDraft] = useState(false);

  useEffect(() => {
    localStorage.setItem("userEmail", "david@dmcommercialconsulting.co.uk");
    localStorage.setItem("userName", "David");
    localStorage.setItem("userRole", "requester");
  }, []);

  const exitSetup = () => setShowSetup(false);

  const handleLaunchPO = () => {
    dismissSetupAssistant();
    exitSetup();
    setApplySetupDraft(true);
    setTab("form");
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
      <BrandHeader activeTab={tab} onTab={setTab} />

      <main style={{ padding: "16px", display: "grid", gap: "16px" }}>
        {tab === "form" && (
          <POForm
            applySetupDraft={applySetupDraft}
            onSetupDraftApplied={() => setApplySetupDraft(false)}
          />
        )}
        {tab === "list" && <POList />}
        {tab === "archive" && <POArchive />}
      </main>
    </div>
  );
}
