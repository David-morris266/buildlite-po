import { useMemo, useState } from 'react';
import { useCommercialAssistant } from './CommercialAssistantContext';
import { RECOMMENDATION_CATEGORY } from './commercialAssistantTypes';

const CATEGORY_LABELS = {
  [RECOMMENDATION_CATEGORY.actionRequired]: 'Action Required',
  [RECOMMENDATION_CATEGORY.warning]: 'Warning',
  [RECOMMENDATION_CATEGORY.information]: 'Information',
  [RECOMMENDATION_CATEGORY.opportunity]: 'Opportunity',
};

function RecommendationCard({
  recommendation,
  onOpen,
  onDismiss,
  onDefer,
}) {
  const [deferUntil, setDeferUntil] = useState('');
  const [deferReason, setDeferReason] = useState('');
  const [showDeferForm, setShowDeferForm] = useState(false);
  const [localError, setLocalError] = useState('');

  function handleDismiss() {
    setLocalError('');
    const result = onDismiss({
      fingerprint: recommendation.fingerprint,
      reason: '',
    });
    if (!result?.ok) {
      setLocalError(result.errors?.[0] || 'Unable to dismiss recommendation');
    }
  }

  function handleDeferSubmit(event) {
    event.preventDefault();
    setLocalError('');
    const result = onDefer({
      fingerprint: recommendation.fingerprint,
      deferUntil: deferUntil || null,
      deferReason,
    });
    if (!result?.ok) {
      setLocalError(result.errors?.[0] || 'Unable to defer recommendation');
      return;
    }
    setShowDeferForm(false);
    setDeferUntil('');
    setDeferReason('');
  }

  return (
    <article className="po-assistant-card">
      <header className="po-assistant-card__header">
        <span className={`po-assistant-card__category po-assistant-card__category--${recommendation.category}`}>
          {CATEGORY_LABELS[recommendation.category] || recommendation.category}
        </span>
        <span className={`po-assistant-card__priority po-assistant-card__priority--${recommendation.priority}`}>
          {recommendation.priority}
        </span>
      </header>

      <h3 className="po-assistant-card__title">{recommendation.title}</h3>
      <p className="po-assistant-card__description">{recommendation.description}</p>

      <dl className="po-assistant-card__facts">
        <div>
          <dt>Financial impact</dt>
          <dd>{recommendation.financialImpact || '—'}</dd>
        </div>
        <div>
          <dt>Recommended next step</dt>
          <dd>{recommendation.recommendation}</dd>
        </div>
      </dl>

      {recommendation.evidence?.length ? (
        <ul className="po-assistant-card__evidence">
          {recommendation.evidence.map((item) => (
            <li key={`${item.label}-${item.value}`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="po-assistant-card__actions">
        <button type="button" className="po-btn-primary" onClick={() => onOpen(recommendation)}>
          Open record
        </button>
        <button type="button" className="po-btn-secondary" onClick={handleDismiss}>
          Dismiss
        </button>
        <button
          type="button"
          className="po-btn-secondary"
          onClick={() => setShowDeferForm((value) => !value)}
        >
          Defer
        </button>
      </div>

      {showDeferForm ? (
        <form className="po-assistant-card__defer" onSubmit={handleDeferSubmit}>
          <label>
            Defer until
            <input
              type="date"
              value={deferUntil}
              onChange={(event) => setDeferUntil(event.target.value)}
            />
          </label>
          <label>
            Reason
            <input
              type="text"
              value={deferReason}
              onChange={(event) => setDeferReason(event.target.value)}
              placeholder="Optional if a defer date is set"
            />
          </label>
          <button type="submit" className="po-btn-secondary">
            Save deferral
          </button>
        </form>
      ) : null}

      {localError ? (
        <p className="po-assistant-card__error" role="alert">
          {localError}
        </p>
      ) : null}
    </article>
  );
}

export default function CommercialAssistantDrawer() {
  const assistant = useCommercialAssistant();
  const recommendations = assistant?.recommendations || [];

  const groupedCountLabel = useMemo(() => {
    const actionRequired = recommendations.filter(
      (item) => item.category === RECOMMENDATION_CATEGORY.actionRequired
    ).length;
    const warnings = recommendations.filter(
      (item) => item.category === RECOMMENDATION_CATEGORY.warning
    ).length;
    const information = recommendations.filter(
      (item) => item.category === RECOMMENDATION_CATEGORY.information
    ).length;

    return `${actionRequired} action required · ${warnings} warnings · ${information} information`;
  }, [recommendations]);

  if (!assistant?.drawerOpen) return null;

  return (
    <div className="po-assistant-drawer" role="dialog" aria-modal="true" aria-label="Commercial Assistant">
      <button
        type="button"
        className="po-assistant-drawer__backdrop"
        aria-label="Close Commercial Assistant"
        onClick={assistant.closeDrawer}
      />
      <aside className="po-assistant-drawer__panel">
        <header className="po-assistant-drawer__header">
          <div>
            <h2>Commercial Assistant</h2>
            <p>{groupedCountLabel}</p>
          </div>
          <button type="button" className="po-assistant-drawer__close" onClick={assistant.closeDrawer}>
            Close
          </button>
        </header>

        {!assistant.scope.developmentId ? (
          <p className="po-assistant-drawer__empty">
            Open a development to view commercial recommendations for that project.
          </p>
        ) : recommendations.length === 0 ? (
          <p className="po-assistant-drawer__empty">
            No open recommendations for this development.
          </p>
        ) : (
          <div className="po-assistant-drawer__list">
            {recommendations.map((recommendation) => (
              <RecommendationCard
                key={recommendation.fingerprint}
                recommendation={recommendation}
                onOpen={(item) => assistant.navigateToRecommendation(item)}
                onDismiss={assistant.dismiss}
                onDefer={assistant.defer}
              />
            ))}
          </div>
        )}

        {assistant.navigationError ? (
          <p className="po-assistant-drawer__error" role="alert">
            {assistant.navigationError}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
