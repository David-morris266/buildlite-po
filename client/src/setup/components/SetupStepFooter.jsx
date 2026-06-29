/**
 * Shared Back / Continue footer for setup steps (BL-007A.02+).
 */
export default function SetupStepFooter({
  onBack,
  onContinue,
  continueLabel = "Continue",
  backLabel = "Back",
  continueFormId,
  wide = false,
}) {
  return (
    <div className={`setup-footer${wide ? " setup-footer--wide" : ""}`}>
      <div className="setup-footer__inner">
        <button
          type="button"
          className="setup-btn setup-btn--secondary"
          onClick={onBack}
        >
          {backLabel}
        </button>
        <button
          type={continueFormId ? "submit" : "button"}
          form={continueFormId || undefined}
          className="setup-btn setup-btn--primary"
          onClick={continueFormId ? undefined : onContinue}
        >
          {continueLabel}
        </button>
      </div>
    </div>
  );
}
