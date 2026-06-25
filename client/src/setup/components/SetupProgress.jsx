import { SETUP_TOTAL_STEPS } from "../constants";

/**
 * Progress indicator — visible on every Setup Assistant screen (Doc 25 §3).
 */
export default function SetupProgress({ currentStep = 1 }) {
  const pct = Math.round((currentStep / SETUP_TOTAL_STEPS) * 100);

  return (
    <div className="setup-progress" role="status" aria-live="polite">
      <div className="setup-progress__meta">
        <span className="setup-progress__label">
          Step {currentStep} of {SETUP_TOTAL_STEPS}
        </span>
        <span className="setup-progress__hint">Setup Assistant</span>
      </div>
      <div
        className="setup-progress__track"
        role="progressbar"
        aria-valuenow={currentStep}
        aria-valuemin={1}
        aria-valuemax={SETUP_TOTAL_STEPS}
        aria-label={`Setup progress: step ${currentStep} of ${SETUP_TOTAL_STEPS}`}
      >
        <div
          className="setup-progress__fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
