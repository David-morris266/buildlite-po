/**
 * Shared Back / Continue footer for setup steps (BL-007A.02+).
 */
export default function SetupStepFooter({
  onBack,
  onContinue,
  continueLabel = "Continue",
  backLabel = "Back",
}) {
  return (
    <div className="setup-footer">
      <div className="setup-footer__inner">
        <button
          type="button"
          className="setup-btn setup-btn--secondary"
          onClick={onBack}
        >
          {backLabel}
        </button>
        <button
          type="button"
          className="setup-btn setup-btn--primary"
          onClick={onContinue}
        >
          {continueLabel}
        </button>
      </div>
    </div>
  );
}
