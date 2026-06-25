import { useState } from "react";
import SetupLayout from "./components/SetupLayout";
import SetupWelcome from "./screens/SetupWelcome";
import "./setup.css";

const STORAGE_KEY = "buildlite_setup_dismissed";

export function isSetupDismissed() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissSetupAssistant() {
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * Setup Assistant entry — BL-007A.01 Welcome only.
 * Later screens plug into step state in BL-007A.02+.
 */
export default function SetupAssistant({ onExit }) {
  const [step] = useState(1);
  const [notice, setNotice] = useState("");

  const handleStartSetup = () => {
    setNotice("The next step will open here in BL-007A.02.");
    window.setTimeout(() => setNotice(""), 4000);
  };

  const handleDoLater = () => {
    dismissSetupAssistant();
    onExit?.();
  };

  return (
    <SetupLayout currentStep={step} showProgress>
      {notice ? (
        <div className="setup-toast" role="status">
          {notice}
        </div>
      ) : null}
      <SetupWelcome
        onStartSetup={handleStartSetup}
        onDoLater={handleDoLater}
      />
    </SetupLayout>
  );
}
