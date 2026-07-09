import { formatMoney } from './poDrawerHelpers';

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

function PackageTable({ packages }) {
  if (!packages?.length) {
    return (
      <>
        <p className="dev-workspace__section-lead">No subcontract packages yet.</p>
        <p className="dev-workspace__section-support">
          Approve subcontract Purchase Orders for this development to create packages
          automatically.
        </p>
      </>
    );
  }

  return (
    <div className="po-table-wrap">
      <table className="po-data-table dev-workspace__packages-table">
        <thead>
          <tr>
            <th>Supplier</th>
            <th>Cost Code</th>
            <th>POs</th>
            <th style={{ textAlign: 'right' }}>Committed</th>
            <th style={{ textAlign: 'right' }}>Certificates</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((pkg) => (
            <tr key={pkg.orderKey}>
              <td>{pkg.supplierLabel || '—'}</td>
              <td>{pkg.costCode || '—'}</td>
              <td>{pkg.poNumbers?.join(', ') || '—'}</td>
              <td style={{ textAlign: 'right' }}>
                £{formatMoney(pkg.committedValue || 0)}
              </td>
              <td style={{ textAlign: 'right' }}>{pkg.certificateCount || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DevelopmentOverview({ model }) {
  if (!model) return null;

  const setupItems = [
    {
      label: 'Plot Master',
      complete: model.plotCount > 0,
      detail: model.plotCount > 0 ? `${model.plotCount} plots` : 'Import plot schedule',
    },
    {
      label: 'Purchase Orders',
      complete: model.purchaseOrderCount > 0,
      detail:
        model.purchaseOrderCount > 0
          ? `${model.purchaseOrderCount} raised`
          : 'Raise subcontract POs',
    },
    {
      label: 'Packages',
      complete: model.packageCount > 0,
      detail:
        model.packageCount > 0
          ? `${model.packageCount} active`
          : 'Approve subcontract POs',
    },
    {
      label: 'Ledger',
      complete: model.ledgerTransactionCount > 0,
      detail:
        model.ledgerTransactionCount > 0
          ? `${model.ledgerTransactionCount} transactions`
          : 'Import purchase ledger',
    },
  ];

  return (
    <>
      <div className="dev-workspace__grid">
        <section className="po-module-card dev-workspace__section">
          <h2 className="po-matrix-section__title">Setup progress</h2>
          <ul className="dev-workspace__setup-list">
            {setupItems.map((item) => (
              <li
                key={item.label}
                className={`dev-workspace__setup-item${
                  item.complete ? ' dev-workspace__setup-item--complete' : ''
                }`}
              >
                <span className="dev-workspace__setup-label">{item.label}</span>
                <span className="dev-workspace__setup-detail">{item.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="po-module-card dev-workspace__section">
          <h2 className="po-matrix-section__title">Packages</h2>
          <PackageTable packages={model.packages} />
        </section>
      </div>
    </>
  );
}

export function DevelopmentPackagesTab({ model }) {
  return (
    <section className="po-module-card dev-workspace__section">
      <h2 className="po-matrix-section__title">Packages</h2>
      <PackageTable packages={model?.packages} />
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
