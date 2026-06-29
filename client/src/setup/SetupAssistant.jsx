import { useCallback, useState } from "react";
import SetupLayout from "./components/SetupLayout";
import SetupStepFooter from "./components/SetupStepFooter";
import SetupWelcome from "./screens/SetupWelcome";
import SetupAboutBusiness from "./screens/SetupAboutBusiness";
import SetupCompanyIdentity from "./screens/SetupCompanyIdentity";
import SetupCompanyDefaults from "./screens/SetupCompanyDefaults";
import SetupFirstOrder from "./screens/SetupFirstOrder";
import SetupApproval from "./screens/SetupApproval";
import SetupReady from "./screens/SetupReady";
import {
  loadSetupDraft,
  saveSetupDraft,
  validateBusiness,
  validateDefaults,
  validateFirstOrder,
  validateApproval,
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

export default function SetupAssistant({ onExit, onLaunchPO, onExplore }) {
  const initial = loadSetupDraft();
  const [step, setStep] = useState(initial.step);
  const [business, setBusiness] = useState(initial.business);
  const [identity, setIdentity] = useState(initial.identity);
  const [defaults, setDefaults] = useState(initial.defaults);
  const [firstOrder, setFirstOrder] = useState(initial.firstOrder);
  const [approval, setApproval] = useState(initial.approval);
  const [errors, setErrors] = useState({});

  const persist = useCallback(
    (
      nextStep,
      nextBusiness,
      nextIdentity,
      nextDefaults,
      nextFirstOrder,
      nextApproval
    ) => {
      saveSetupDraft(
        nextStep,
        nextBusiness,
        nextIdentity,
        nextDefaults,
        nextFirstOrder ?? firstOrder,
        nextApproval ?? approval
      );
    },
    [firstOrder, approval]
  );

  const handleStartSetup = () => {
    setStep(2);
    persist(2, business, identity, defaults, firstOrder, approval);
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
    persist(prev, business, identity, defaults, firstOrder, approval);
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
    persist(3, nextBusiness, identity, defaults, firstOrder, approval);
  };

  const handleIdentityContinue = () => {
    setStep(4);
    persist(4, business, identity, defaults, firstOrder, approval);
  };

  const handleDefaultsContinue = () => {
    const validation = validateDefaults(defaults);
    setErrors(validation);
    if (Object.keys(validation).length) return;

    setStep(5);
    persist(5, business, identity, defaults, firstOrder, approval);
  };

  const handleFirstOrderContinue = () => {
    const validation = validateFirstOrder(firstOrder);
    setErrors(validation);
    if (Object.keys(validation).length) return;

    const nextFirstOrder = finalizeFirstOrder(firstOrder);
    setFirstOrder(nextFirstOrder);
    setStep(6);
    persist(6, business, identity, defaults, nextFirstOrder, approval);
  };

  const handleApprovalContinue = () => {
    const validation = validateApproval(approval);
    setErrors(validation);
    if (Object.keys(validation).length) return;

    setStep(7);
    persist(7, business, identity, defaults, firstOrder, approval);
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
            : step === 6
              ? SETUP_FORM_IDS.approval
              : undefined;

  const footer =
    step >= 2 && step <= 6 ? (
      <SetupStepFooter
        onBack={handleBack}
        onContinue={
          step === 2
            ? handleBusinessContinue
            : step === 3
              ? handleIdentityContinue
              : step === 4
                ? handleDefaultsContinue
                : step === 5
                  ? handleFirstOrderContinue
                  : handleApprovalContinue
        }
        continueFormId={continueFormId}
        wide={step === 3 || step === 6}
      />
    ) : null;

  return (
    <SetupLayout currentStep={step} showProgress footer={footer}>
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
            persist(2, next, identity, defaults, firstOrder, approval);
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
            persist(3, business, next, defaults, firstOrder, approval);
          }}
          onSubmit={handleIdentityContinue}
        />
      )}

      {step === 4 && (
        <SetupCompanyDefaults
          value={defaults}
          onChange={(next) => {
            setDefaults(next);
            persist(4, business, identity, next, firstOrder, approval);
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
            persist(5, business, identity, defaults, next, approval);
          }}
          errors={errors}
          onSubmit={handleFirstOrderContinue}
        />
      )}

      {step === 6 && (
        <SetupApproval
          value={approval}
          firstOrder={firstOrder}
          onChange={(next) => {
            setApproval(next);
            persist(6, business, identity, defaults, firstOrder, next);
          }}
          errors={errors}
          onSubmit={handleApprovalContinue}
        />
      )}

      {step === 7 && (
        <SetupReady
          business={business}
          identity={identity}
          defaults={defaults}
          firstOrder={firstOrder}
          onLaunchPO={onLaunchPO}
          onExplore={onExplore}
          onFinishLater={handleDoLater}
        />
      )}
    </SetupLayout>
  );
}
