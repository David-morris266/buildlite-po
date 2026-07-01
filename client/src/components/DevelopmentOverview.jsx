export function SummaryDashboard({ cards }) {
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

export default function DevelopmentOverview({ model }) {
  if (!model) return null;

  return (
    <>
      <div className="dev-workspace__grid">
        <section className="po-module-card dev-workspace__section">
          <h2 className="po-matrix-section__title">Packages</h2>
          <p className="dev-workspace__section-lead">
            No subcontract packages yet.
          </p>
          <p className="dev-workspace__section-support">
            Future Purchase Orders will appear here automatically.
          </p>
        </section>

        <section className="po-module-card dev-workspace__section">
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
      </div>
    </>
  );
}

export function DevelopmentPackagesTab() {
  return (
    <section className="po-module-card dev-workspace__section">
      <h2 className="po-matrix-section__title">Packages</h2>
      <p className="dev-workspace__section-lead">No subcontract packages yet.</p>
      <p className="dev-workspace__section-support">
        Future Purchase Orders will appear here automatically.
      </p>
    </section>
  );
}

export function DevelopmentCommercialTab({ model }) {
  if (!model) return null;

  return (
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
  );
}
