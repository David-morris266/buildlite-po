import { formatDisplayMoney, formatSignedDisplayMoney } from './poDrawerHelpers';
import { buildSubcontractOrderKey } from '../payments/packageKeyMigration';
import { buildPackageCommercialDisplayFields } from '../commercialEvents/commercialEventPackageValue';
import {
  buildPackageTableCostCodeDisplay,
  buildPackageTableSecondaryTooltip,
  buildPackageTableSupplierDisplay,
} from '../developments/developmentPackageTableDisplay';
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
      <div className="po-table-wrap dev-workspace__packages-wrap">
        <table className="po-data-table dev-workspace__packages-table">
          <colgroup>
            <col className="dev-workspace__packages-col dev-workspace__packages-col--supplier" />
            <col className="dev-workspace__packages-col dev-workspace__packages-col--cost-code" />
            <col className="dev-workspace__packages-col dev-workspace__packages-col--approved" />
            <col className="dev-workspace__packages-col dev-workspace__packages-col--current" />
            <col className="dev-workspace__packages-col dev-workspace__packages-col--action" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Supplier</th>
              <th scope="col">Cost code</th>
              <th scope="col" className="dev-workspace__packages-num">
                <abbr title="Approved commercial events">Approved</abbr>
              </th>
              <th scope="col" className="dev-workspace__packages-num">
                <abbr title="Current package value">Current</abbr>
              </th>
              <th scope="col" className="dev-workspace__packages-action-head">
                <span className="visually-hidden">Open package</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {packages.map((pkg) => {
              const commercialDisplay = buildPackageCommercialDisplayFields(pkg);
              const supplier = buildPackageTableSupplierDisplay(pkg.supplierLabel);
              const costCode = buildPackageTableCostCodeDisplay(pkg);
              const secondaryTooltip = buildPackageTableSecondaryTooltip(
                pkg,
                commercialDisplay
              );

              return (
              <tr
                key={pkg.orderKey || buildSubcontractOrderKey(
                  pkg.developmentId,
                  pkg.supplierId,
                  pkg.costCode
                )}
                className="dev-workspace__packages-row"
                title={secondaryTooltip || undefined}
              >
                <td className="dev-workspace__packages-supplier-cell">
                  <span
                    className="dev-workspace__packages-supplier"
                    title={supplier.truncated ? supplier.full : undefined}
                  >
                    {supplier.compact}
                  </span>
                </td>
                <td className="dev-workspace__packages-cost-cell">
                  <span
                    className="dev-workspace__packages-cost-code"
                    title={costCode.truncated || costCode.description ? costCode.full : secondaryTooltip || undefined}
                  >
                    {costCode.compact}
                  </span>
                </td>
                <td className="dev-workspace__packages-num">
                  <span className="dev-workspace__packages-money">
                    {formatSignedDisplayMoney(
                      commercialDisplay.approvedCommercialEventMovement
                    )}
                  </span>
                </td>
                <td className="dev-workspace__packages-num">
                  <span className="dev-workspace__packages-money">
                    {formatDisplayMoney(commercialDisplay.currentPackageValue)}
                  </span>
                </td>
                <td className="dev-workspace__packages-action">
                  <button
                    type="button"
                    className="dev-workspace__packages-open dev-workspace__packages-open--compact"
                    aria-label={buildOpenPackageLabel(pkg)}
                    title={secondaryTooltip || 'Open package'}
                    onClick={() => handleOpenPackage(pkg)}
                  >
                    <span className="dev-workspace__packages-open-label">Open</span>
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
