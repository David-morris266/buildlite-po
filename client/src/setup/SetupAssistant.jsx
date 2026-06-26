import { useCallback, useState } from "react";
import SetupLayout from "./components/SetupLayout";
import SetupStepFooter from "./components/SetupStepFooter";
import SetupWelcome from "./screens/SetupWelcome";
import SetupAboutBusiness from "./screens/SetupAboutBusiness";
import SetupCompanyIdentity from "./screens/SetupCompanyIdentity";
import {
  loadSetupDraft,
  saveSetupDraft,
  validateBusiness,
  canContinue,
  resolveTradingName,
} from "./setupDraft";
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

export default function SetupAssistant({ onExit }) {
  const initial = loadSetupDraft();
  const [step, setStep] = useState(initial.step);
  const [business, setBusiness] = useState(initial.business);
  const [identity, setIdentity] = useState(initial.identity);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");

  const showNotice = useCallback((message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4000);
  }, []);

  const persist = useCallback((nextStep, nextBusiness, nextIdentity) => {
    saveSetupDraft(nextStep, nextBusiness, nextIdentity);
  }, []);

  const handleStartSetup = () => {
    setStep(2);
    persist(2, business, identity);
  };

  const handleDoLater = () => {
    dismissSetupAssistant();
    onExit?.();
  };

  const handleBack = () => {
    setErrors({});
    if (step <= 1) return;
    const prev = step - 1;
    setStep(prev);
    persist(prev, business, identity);
  };

  const handleBusinessContinue = () => {
    const nextBusiness = {
      ...business,
      tradingName: resolveTradingName(
        business.companyName,
        business.tradingName
      ),
    };
    const validation = validateBusiness(nextBusiness);
    setErrors(validation);

    if (!canContinue(validation)) return;

    setBusiness(nextBusiness);
    setStep(3);
    persist(3, nextBusiness, identity);
  };

  const handleIdentityContinue = () => {
    persist(3, business, identity);
    showNotice("Saved locally. The next step will arrive in BL-007A.04.");
  };

  const footer =
    step === 2 || step === 3 ? (
      <SetupStepFooter
        onBack={handleBack}
        onContinue={step === 2 ? handleBusinessContinue : handleIdentityContinue}
      />
    ) : null;

  return (
    <SetupLayout currentStep={step} showProgress footer={footer}>
      {notice ? (
        <div className="setup-toast" role="status">
          {notice}
        </div>
      ) : null}

      {step === 1 && (
        <SetupWelcome
          onStartSetup={handleStartSetup}
          onDoLater={handleDoLater}
        />
      )}

      {step === 2 && (
        <SetupAboutBusiness
          value={business}
          onChange={(next) => {
            setBusiness(next);
            persist(2, next, identity);
          }}
          errors={errors}
          onSubmit={handleBusinessContinue}
        />
      )}

      {step === 3 && (
        <SetupCompanyIdentity
          identity={identity}
          business={business}
          onChange={(next) => {
            setIdentity(next);
            persist(3, business, next);
          }}
          onSubmit={handleIdentityContinue}
        />
      )}
    </SetupLayout>
  );
}
