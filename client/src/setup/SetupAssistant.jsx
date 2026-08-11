import { useCallback, useEffect, useState } from 'react';
import SetupLayout from './components/SetupLayout';
import SetupStepFooter from './components/SetupStepFooter';
import OnboardingWelcome from './screens/OnboardingWelcome';
import OnboardingCompany from './screens/OnboardingCompany';
import OnboardingCommercial from './screens/OnboardingCommercial';
import OnboardingCostCodes from './screens/OnboardingCostCodes';
import OnboardingSupplier from './screens/OnboardingSupplier';
import OnboardingApproval from './screens/OnboardingApproval';
import OnboardingDevelopment from './screens/OnboardingDevelopment';
import OnboardingReady from './screens/OnboardingReady';
import {
  loadOnboardingDraft,
  saveOnboardingDraft,
  validateCommercialDefaultsStep,
  validateCompanyStep,
  validateCostCodesStep,
  validateDevelopmentStep,
  validateSupplierStep,
} from './onboardingDraft';
import {
  commitApprovalSection,
  commitCommercialDefaultsSection,
  commitCompanySection,
  commitCostCodesSection,
  commitDevelopmentSection,
  commitSetupComplete,
  commitSupplierSection,
} from './setupCommit';
import { listCostCodeMasterRecords } from '../admin/costCodeMasterStore';
import { generateNextDevelopmentNumber } from '../admin/numberingService';
import {
  getFirstIncompleteStep,
  getResumeStep,
  isSetupComplete,
  markSetupStarted,
} from './setupProgressStore';
import { SETUP_FORM_IDS } from './constants';
import { buildPoFormSeedFromSetup, loadSetupDraft } from './setupDraft';
import './setup.css';

const STORAGE_DISMISSED_KEY = 'buildlite_setup_dismissed';
const SKIPPABLE_STEPS = new Set([5, 6, 7]);

export function isSetupDismissed() {
  try {
    return sessionStorage.getItem(STORAGE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissSetupAssistant() {
  try {
    sessionStorage.setItem(STORAGE_DISMISSED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function shouldShowSetupAssistant(force = false) {
  if (force) return true;
  const params = new URLSearchParams(window.location.search);
  if (params.get('setup') === '1') return true;
  if (isSetupDismissed()) return false;
  return !isSetupComplete();
}

export default function SetupAssistant({
  onExit,
  onLaunchPO,
  onOpenAdministration,
  onOpenDevelopments,
  initialStep = null,
  fromAdministration = false,
}) {
  const initial = loadOnboardingDraft();
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [costCodesWizardOpen, setCostCodesWizardOpen] = useState(false);

  useEffect(() => {
    if (initialStep != null) {
      setDraft((current) => saveOnboardingDraft({ ...current, step: initialStep }));
      return;
    }

    const loaded = loadOnboardingDraft();
    const resumeStep = getResumeStep(loaded.step);
    if (loaded.step > 1 && resumeStep !== loaded.step) {
      setDraft(saveOnboardingDraft({ ...loaded, step: resumeStep }));
    }
  }, [initialStep]);

  const step = draft.step || 1;

  const persist = useCallback((nextDraft) => {
    const saved = saveOnboardingDraft(nextDraft);
    setDraft(saved);
    return saved;
  }, []);

  function goToStep(nextStep, patch = {}) {
    persist({ ...draft, ...patch, step: nextStep });
    setErrors({});
  }

  function handleStart() {
    markSetupStarted();
    goToStep(getFirstIncompleteStep());
  }

  function handleResume() {
    markSetupStarted();
    goToStep(getResumeStep(draft.step));
  }

  function handleExit() {
    if (!fromAdministration) dismissSetupAssistant();
    onExit?.();
  }

  function handleBack() {
    if (step <= 2) {
      goToStep(1);
      return;
    }
    goToStep(step - 1);
  }

  function handleSkip() {
    if (!SKIPPABLE_STEPS.has(step)) return;
    goToStep(step + 1);
  }

  async function handleCompanyContinue() {
    const validation = validateCompanyStep(draft.company);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    const result = commitCompanySection(draft.company);
    if (!result?.ok) return;
    goToStep(3);
  }

  function handleCommercialContinue() {
    const validation = validateCommercialDefaultsStep(draft.commercialDefaults);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    const result = commitCommercialDefaultsSection(draft.commercialDefaults);
    if (!result?.ok) return;
    goToStep(4);
  }

  function handleCostCodesContinue() {
    const validation = validateCostCodesStep(
      draft.costCodes,
      listCostCodeMasterRecords().length
    );
    setErrors(validation);
    if (Object.keys(validation).length) return;

    const result = commitCostCodesSection(draft.costCodes);
    if (!result?.ok) {
      setErrors({ costCodes: result.error || 'Could not complete cost code setup.' });
      return;
    }

    persist({
      ...draft,
      costCodes: { ...draft.costCodes, importCommitted: true },
      step: 5,
    });
    setErrors({});
  }

  async function handleSupplierContinue() {
    const validation = validateSupplierStep(draft.supplier);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    setBusy(true);
    try {
      const result = await commitSupplierSection(draft.supplier);
      if (!result?.ok) {
        setErrors({ name: 'Could not save supplier.' });
        return;
      }
      persist({
        ...draft,
        supplier: { ...draft.supplier, supplierId: result.supplier?.id || draft.supplier.supplierId },
        step: 6,
      });
    } catch (err) {
      setErrors({ name: err.message || 'Could not save supplier.' });
    } finally {
      setBusy(false);
    }
  }

  function handleApprovalContinue() {
    const result = commitApprovalSection(draft.approval);
    if (!result?.ok) return;
    goToStep(7);
  }

  async function handleDevelopmentContinue() {
    const development = {
      ...draft.development,
      developmentCode: String(draft.development.developmentCode || '').trim()
        || generateNextDevelopmentNumber(),
    };
    const validation = validateDevelopmentStep(development);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    try {
      const result = await commitDevelopmentSection(development);
      if (!result?.ok) return;
      if (result.development?.id) {
        persist({
          ...draft,
          development: { ...development, developmentId: result.development.id },
          step: 8,
        });
      } else {
        goToStep(8);
      }
    } catch (error) {
      setErrors({
        developmentName: error.message || 'Could not create development on the server.',
      });
    }
  }

  function handleFinish() {
    commitSetupComplete();
    if (!fromAdministration) dismissSetupAssistant();
    onExit?.();
  }

  const continueFormId =
    step === 2
      ? SETUP_FORM_IDS.company
      : step === 3
        ? SETUP_FORM_IDS.commercial
        : step === 5
          ? SETUP_FORM_IDS.supplier
          : step === 6
            ? SETUP_FORM_IDS.approval
            : step === 7
              ? SETUP_FORM_IDS.development
              : undefined;

  const continueHandler =
    step === 2
      ? handleCompanyContinue
      : step === 3
        ? handleCommercialContinue
        : step === 4
          ? handleCostCodesContinue
          : step === 5
            ? handleSupplierContinue
            : step === 6
              ? handleApprovalContinue
              : step === 7
                ? handleDevelopmentContinue
                : undefined;

  const footer =
    step >= 2 && step <= 7 ? (
      <SetupStepFooter
        onBack={handleBack}
        onContinue={continueHandler}
        continueFormId={continueFormId}
        continueDisabled={busy || (step === 4 && costCodesWizardOpen)}
        continueLabel={busy ? 'Saving…' : 'Continue'}
        onSkip={SKIPPABLE_STEPS.has(step) ? handleSkip : undefined}
        onExitSetup={handleExit}
        showContinue={!(step === 4 && costCodesWizardOpen)}
      />
    ) : null;

  return (
    <SetupLayout currentStep={step} showProgress={step > 1} footer={footer}>
      {step === 1 ? (
        <OnboardingWelcome
          onStart={handleStart}
          onResume={handleResume}
          onExit={handleExit}
          canResume={draft.step > 1 || isSetupComplete() === false}
        />
      ) : null}

      {step === 2 ? (
        <OnboardingCompany
          value={draft.company}
          onChange={(company) => persist({ ...draft, company })}
          errors={errors}
          onSubmit={handleCompanyContinue}
        />
      ) : null}

      {step === 3 ? (
        <OnboardingCommercial
          value={draft.commercialDefaults}
          onChange={(commercialDefaults) => persist({ ...draft, commercialDefaults })}
          errors={errors}
          onSubmit={handleCommercialContinue}
        />
      ) : null}

      {step === 4 ? (
        <OnboardingCostCodes
          value={draft.costCodes}
          onChange={(costCodes) => persist({ ...draft, costCodes })}
          errors={errors}
          onWizardActiveChange={setCostCodesWizardOpen}
        />
      ) : null}

      {step === 5 ? (
        <OnboardingSupplier
          value={draft.supplier}
          onChange={(supplier) => persist({ ...draft, supplier })}
          errors={errors}
          onSubmit={handleSupplierContinue}
        />
      ) : null}

      {step === 6 ? (
        <OnboardingApproval
          value={draft.approval}
          onChange={(approval) => persist({ ...draft, approval })}
          onSubmit={handleApprovalContinue}
        />
      ) : null}

      {step === 7 ? (
        <OnboardingDevelopment
          company={draft.company}
          value={draft.development}
          onChange={(development) => persist({ ...draft, development })}
          errors={errors}
          onSubmit={handleDevelopmentContinue}
        />
      ) : null}

      {step === 8 ? (
        <OnboardingReady
          onCreatePO={() => {
            commitSetupComplete();
            dismissSetupAssistant();
            onLaunchPO?.(buildPoFormSeedFromSetup(loadSetupDraft()));
          }}
          onOpenAdministration={() => {
            commitSetupComplete();
            dismissSetupAssistant();
            onOpenAdministration?.();
          }}
          onCreateDevelopment={() => {
            commitSetupComplete();
            dismissSetupAssistant();
            onOpenDevelopments?.();
          }}
          onImportBudget={() => {
            commitSetupComplete();
            dismissSetupAssistant();
            onOpenDevelopments?.();
          }}
          onFinish={handleFinish}
        />
      ) : null}
    </SetupLayout>
  );
}
