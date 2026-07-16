import { getCompletedSectionCount, getSetupPercentComplete, SETUP_SECTIONS, isSectionComplete } from '../setupProgressStore';

export default function OnboardingWelcome({ onStart, onResume, onExit, canResume }) {
  const completed = getCompletedSectionCount();
  const pct = getSetupPercentComplete();

  return (
    <section className="setup-step setup-step--welcome">
      <h1 className="setup-step__title">Welcome to BuildLite</h1>
      <p className="setup-step__lead">
        Configure your company, commercial structure and master data in under 15 minutes.
        Progress is saved automatically — you can leave and return at any time.
      </p>

      <div className="setup-overview-card po-module-card">
        <div className="setup-overview-card__head">
          <span>Setup Progress</span>
          <strong>{completed} of {SETUP_SECTIONS.length} complete · {pct}%</strong>
        </div>
        <div className="setup-overview-card__track">
          <div className="setup-overview-card__fill" style={{ width: `${pct}%` }} />
        </div>
        <ul className="setup-overview-card__list">
          {SETUP_SECTIONS.map((section) => (
            <li key={section.id} className={isSectionComplete(section.id) ? 'is-done' : ''}>
              <span aria-hidden="true">{isSectionComplete(section.id) ? '✓' : '○'}</span>
              {section.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="setup-step__actions">
        <button type="button" className="po-btn-primary" onClick={onStart}>
          {canResume ? 'Continue setup' : 'Start setup'}
        </button>
        {canResume ? (
          <button type="button" className="po-list-btn-secondary" onClick={onResume}>
            Resume where I left off
          </button>
        ) : null}
        <button type="button" className="setup-step__link" onClick={onExit}>
          Finish later
        </button>
      </div>
    </section>
  );
}
