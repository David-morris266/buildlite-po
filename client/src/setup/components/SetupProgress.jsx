import { SETUP_SECTIONS, getCompletedSectionCount, getSetupPercentComplete, isSectionComplete } from '../setupProgressStore';
import { SETUP_STEPS, SETUP_TOTAL_STEPS } from '../constants';

export default function SetupProgress({ currentStep = 1 }) {
  const completedCount = getCompletedSectionCount();
  const pct = getSetupPercentComplete();
  const stepMeta = SETUP_STEPS[currentStep - 1];
  const stepName = stepMeta?.progressTitle || stepMeta?.label || 'Setup Assistant';
  const currentSection = stepMeta?.sectionId
    ? SETUP_SECTIONS.find((item) => item.id === stepMeta.sectionId)?.label
    : null;

  return (
    <div className="setup-progress setup-progress--onboarding" role="status" aria-live="polite">
      <div className="setup-progress__meta">
        <div className="setup-progress__labels">
          <span className="setup-progress__label">
            {currentStep === 1
              ? 'BuildLite Setup'
              : `Step ${currentStep} of ${SETUP_TOTAL_STEPS}`}
          </span>
          <span className="setup-progress__step-name">{stepName}</span>
          {currentSection ? (
            <span className="setup-progress__section">{currentSection}</span>
          ) : null}
        </div>
        <div className="setup-progress__summary">
          <strong>{completedCount} of {SETUP_SECTIONS.length} complete</strong>
          <span>{pct}%</span>
        </div>
      </div>

      <div className="setup-progress__sections" aria-label="Setup sections">
        {SETUP_SECTIONS.map((section) => {
          const done = isSectionComplete(section.id);
          return (
            <span
              key={section.id}
              className={`setup-progress__section-chip${done ? ' setup-progress__section-chip--done' : ''}`}
            >
              {done ? '✓' : '○'} {section.label}
            </span>
          );
        })}
      </div>

      <div
        className="setup-progress__track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Setup progress ${pct}%`}
      >
        <div className="setup-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
