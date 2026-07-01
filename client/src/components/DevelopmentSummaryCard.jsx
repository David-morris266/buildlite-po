import { buildDevelopmentSummaryModel } from '../developments/developmentPoHelpers';

export default function DevelopmentSummaryCard({ development }) {
  const model = buildDevelopmentSummaryModel(development);
  if (!model) return null;

  return (
    <section
      className="po-module-card dev-po-summary"
      aria-label="Selected development summary"
    >
      <div className="dev-po-summary__header">
        <span className="dev-po-summary__eyebrow">Development</span>
        <h3 className="dev-po-summary__title">{model.developmentName}</h3>
      </div>

      <dl className="dev-po-summary__grid">
        <div>
          <dt>Development Number</dt>
          <dd>{model.developmentNumber}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <span
              className={`po-status-badge po-status-badge--${model.statusModifier}`}
            >
              {model.statusLabel}
            </span>
          </dd>
        </div>
        <div>
          <dt>Client</dt>
          <dd>{model.client}</dd>
        </div>
        <div>
          <dt>Plots</dt>
          <dd>{model.plotsLabel}</dd>
        </div>
      </dl>
    </section>
  );
}
