import { useMemo } from 'react';
import POPageHeader from './POPageHeader';
import { formatPoDate } from './poDrawerHelpers';
import { buildDevelopmentWorkspaceModel } from '../developments/developmentHelpers';

function StatusBadge({ status }) {
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

function SummaryDashboard({ cards }) {
  return (
    <section
      className="dev-workspace__cards"
      aria-label="Development workspace summary"
    >
      {cards.map((card) => (
        <div
          key={card.label}
          className={`dev-workspace__card dev-workspace__card--${card.modifier}`}
        >
          <span className="dev-workspace__card-label">{card.label}</span>
          <strong className="dev-workspace__card-value">{card.value}</strong>
        </div>
      ))}
    </section>
  );
}

export default function DevelopmentWorkspace({ development, onBackToList }) {
  const model = useMemo(
    () => buildDevelopmentWorkspaceModel(development),
    [development]
  );

  if (!model) return null;

  return (
    <div className="dev-workspace">
      <POPageHeader
        eyebrow="Development Workspace"
        title={model.developmentName}
        lead={`Development ${model.jobNumber}${model.location ? ` · ${model.location}` : ''}`}
      />

      <div className="dev-workspace__meta">
        <StatusBadge status={model.statusMeta} />
        {model.client ? (
          <span className="dev-workspace__meta-item">Client: {model.client}</span>
        ) : null}
        {model.startDate ? (
          <span className="dev-workspace__meta-item">
            Start: {formatPoDate(model.startDate)}
          </span>
        ) : null}
        {model.targetCompletion ? (
          <span className="dev-workspace__meta-item">
            Target: {formatPoDate(model.targetCompletion)}
          </span>
        ) : null}
      </div>

      <SummaryDashboard cards={model.summaryCards} />

      <div className="dev-workspace__grid">
        <section className="po-module-card dev-workspace__section">
          <h2 className="po-matrix-section__title">Plot Master</h2>
          <p className="dev-workspace__section-lead">
            No plot schedule has been imported.
          </p>
          <button type="button" className="po-btn-primary" disabled>
            Import Plot Schedule
          </button>
        </section>

        <section className="po-module-card dev-workspace__section">
          <h2 className="po-matrix-section__title">Packages</h2>
          <p className="dev-workspace__section-lead">
            No subcontract packages yet.
          </p>
          <p className="dev-workspace__section-support">
            Future Purchase Orders will appear here automatically.
          </p>
        </section>
      </div>

      <section className="po-module-card dev-workspace__commercial">
        <h2 className="po-matrix-section__title">Commercial summary</h2>
        <div className="dev-workspace__commercial-grid">
          {model.commercialCards.map((card) => (
            <div key={card.label} className="dev-workspace__commercial-card">
              <span className="dev-workspace__card-label">{card.label}</span>
              <strong className="dev-workspace__card-value">{card.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <div className="dev-workspace__footer">
        <button
          type="button"
          className="dev-workspace__back"
          onClick={onBackToList}
        >
          Back to Developments
        </button>
      </div>
    </div>
  );
}
