import { formatMoney } from './poDrawerHelpers';
import { buildSubcontractOrderKey } from '../payments/packageKeyMigration';
import {
  buildPackageCommercialDisplayFields,
  formatSignedCommercialEventValue,
} from '../commercialEvents/commercialEventPackageValue';
import {
  buildPackageWorkspaceLaunchContext,
  PACKAGE_OPENED_FROM,
} from '../payments/packageWorkspaceLaunch';

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

function buildOpenPackageLabel(pkg) {
  const supplier = pkg.supplierLabel || 'supplier';
  const costCode = pkg.costCode || 'package';
  return `Open package for ${supplier}, cost code ${costCode}`;
}

export function PackageTable({ packages, onOpenPackage, packageError = null }) {
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

  function handleOpenPackage(pkg) {
    if (!onOpenPackage || !pkg) return;
    const launch = buildPackageWorkspaceLaunchContext({
      packageRow: pkg,
      openedFrom: PACKAGE_OPENED_FROM.DevelopmentPackages,
      initialTab: 'overview',
    });
    if (launch.identityError) {
      onOpenPackage(null, launch);
      return;
    }
    onOpenPackage(launch.orderKey, launch);
  }

  return (
    <>
      {packageError ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {packageError}
        </div>
      ) : null}
      <div className="po-table-wrap">
        <table className="po-data-table dev-workspace__packages-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Cost Code</th>
              <th>POs</th>
              <th style={{ textAlign: 'right' }}>PO Commitment</th>
              <th style={{ textAlign: 'right' }}>Approved Events</th>
              <th style={{ textAlign: 'right' }}>Current Package</th>
              <th style={{ textAlign: 'right' }}>Certificates</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((pkg) => {
              const commercialDisplay = buildPackageCommercialDisplayFields(pkg);
              return (
              <tr
                key={pkg.orderKey || buildSubcontractOrderKey(
                  pkg.developmentId,
                  pkg.supplierId,
                  pkg.costCode
                )}
                className="dev-workspace__packages-row"
              >
                <td>{pkg.supplierLabel || '—'}</td>
                <td>{pkg.costCode || '—'}</td>
                <td>{pkg.poNumbers?.join(', ') || '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  £{formatMoney(commercialDisplay.originalPoCommitment)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {formatSignedCommercialEventValue(
                    commercialDisplay.approvedCommercialEventMovement
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  £{formatMoney(commercialDisplay.currentPackageValue)}
                </td>
                <td style={{ textAlign: 'right' }}>{pkg.certificateCount || 0}</td>
                <td className="dev-workspace__packages-action">
                  <button
                    type="button"
                    className="dev-workspace__packages-open"
                    aria-label={buildOpenPackageLabel(pkg)}
                    onClick={() => handleOpenPackage(pkg)}
                  >
                    <span>Open Package</span>
                    <span className="dev-workspace__packages-chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function DevelopmentOverview({ model, onOpenPackage, packageError = null }) {
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
          <PackageTable
            packages={model.packages}
            onOpenPackage={onOpenPackage}
            packageError={packageError}
          />
        </section>
      </div>
    </>
  );
}

export function DevelopmentPackagesTab({
  model,
  onOpenPackage,
  packageError = null,
}) {
  return (
    <section className="po-module-card dev-workspace__section">
      <h2 className="po-matrix-section__title">Packages</h2>
      <PackageTable
        packages={model?.packages}
        onOpenPackage={onOpenPackage}
        packageError={packageError}
      />
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
