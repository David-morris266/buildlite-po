import { SETUP_SECTIONS, isSectionComplete } from '../setupProgressStore';

export default function OnboardingReady({
  onCreatePO,
  onOpenAdministration,
  onCreateDevelopment,
  onImportBudget,
  onFinish,
}) {
  return (
    <section className="setup-step setup-step--ready">
      <h1 className="setup-step__title">✓ BuildLite is ready</h1>
      <p className="setup-step__lead">Your company is configured and ready for commercial work.</p>

      <ul className="setup-ready-checklist">
        {SETUP_SECTIONS.filter((section) => section.id !== 'complete').map((section) => (
          <li key={section.id} className={isSectionComplete(section.id) ? 'is-done' : ''}>
            <span>{isSectionComplete(section.id) ? '✓' : '○'}</span>
            <span>{section.label}</span>
          </li>
        ))}
      </ul>

      <div className="setup-ready-actions">
        <button type="button" className="po-btn-primary" onClick={onCreatePO}>Create Purchase Order</button>
        <button type="button" className="po-list-btn-secondary" onClick={onOpenAdministration}>Open Administration</button>
        <button type="button" className="po-list-btn-secondary" onClick={onCreateDevelopment}>Create another Development</button>
        <button type="button" className="po-list-btn-secondary" onClick={onImportBudget}>Import Budget</button>
        <button type="button" className="setup-step__link" onClick={onFinish}>Enter BuildLite</button>
      </div>
    </section>
  );
}
