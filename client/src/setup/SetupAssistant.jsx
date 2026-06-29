import { useCallback, useState } from "react";
import SetupLayout from "./components/SetupLayout";
import SetupStepFooter from "./components/SetupStepFooter";
import SetupWelcome from "./screens/SetupWelcome";
import SetupAboutBusiness from "./screens/SetupAboutBusiness";
import SetupCompanyIdentity from "./screens/SetupCompanyIdentity";
import SetupCompanyDefaults from "./screens/SetupCompanyDefaults";
import SetupFirstOrder from "./screens/SetupFirstOrder";
import {
  loadSetupDraft,
  saveSetupDraft,
  validateBusiness,
  validateDefaults,
  validateFirstOrder,
  finalizeFirstOrder,
  canContinue,
  resolveTradingName,
} from "./setupDraft";
import { SETUP_FORM_IDS } from "./constants";
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
  const [defaults, setDefaults] = useState(initial.defaults);
  const [firstOrder, setFirstOrder] = useState(initial.firstOrder);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");

  const showNotice = useCallback((message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4000);
  }, []);

  const persist = useCallback(
    (nextStep, nextBusiness, nextIdentity, nextDefaults, nextFirstOrder) => {
      saveSetupDraft(
        nextStep,
        nextBusiness,
        nextIdentity,
        nextDefaults,
        nextFirstOrder ?? firstOrder
      );
    },
    [firstOrder]
  );

  const handleStartSetup = () => {
    setStep(2);
    persist(2, business, identity, defaults, firstOrder);
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
    persist(prev, business, identity, defaults, firstOrder);
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
    persist(3, nextBusiness, identity, defaults, firstOrder);
  };

  const handleIdentityContinue = () => {
    setStep(4);
    persist(4, business, identity, defaults, firstOrder);
  };

  const handleDefaultsContinue = () => {
    const validation = validateDefaults(defaults);
    setErrors(validation);
    if (Object.keys(validation).length) return;

    setStep(5);
    persist(5, business, identity, defaults, firstOrder);
  };

  const handleFirstOrderContinue = () => {
    const validation = validateFirstOrder(firstOrder);
    setErrors(validation);
    if (Object.keys(validation).length) return;

    const nextFirstOrder = finalizeFirstOrder(firstOrder);
    setFirstOrder(nextFirstOrder);
    setStep(6);
    persist(6, business, identity, defaults, nextFirstOrder);
    showNotice("Next: who approves your orders.");
  };

  const continueFormId =
    step === 2
      ? SETUP_FORM_IDS.business
      : step === 3
        ? SETUP_FORM_IDS.identity
        : step === 4
          ? SETUP_FORM_IDS.defaults
          : step === 5
            ? SETUP_FORM_IDS.firstOrder
            : undefined;

  const footer =
    step >= 2 && step <= 5 ? (
      <SetupStepFooter
        onBack={handleBack}
        onContinue={
          step === 2
            ? handleBusinessContinue
            : step === 3
              ? handleIdentityContinue
              : step === 4
                ? handleDefaultsContinue
                : handleFirstOrderContinue
        }
        continueFormId={continueFormId}
        wide={step === 3}
      />
    ) : null;

  return (
    <SetupLayout currentStep={step} showProgress footer={footer}>
      {notice ? (
        <div className="setup-toast" role="status" aria-live="polite">
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
            persist(2, next, identity, defaults, firstOrder);
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
            persist(3, business, next, defaults, firstOrder);
          }}
          onSubmit={handleIdentityContinue}
        />
      )}

      {step === 4 && (
        <SetupCompanyDefaults
          value={defaults}
          onChange={(next) => {
            setDefaults(next);
            persist(4, business, identity, next, firstOrder);
          }}
          errors={errors}
          onSubmit={handleDefaultsContinue}
        />
      )}

      {step === 5 && (
        <SetupFirstOrder
          value={firstOrder}
          onChange={(next) => {
            setFirstOrder(next);
            persist(5, business, identity, defaults, next);
          }}
          errors={errors}
          onSubmit={handleFirstOrderContinue}
        />
      )}
    </SetupLayout>
  );
}
