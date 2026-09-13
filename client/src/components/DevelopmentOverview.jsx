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

const readinessLabel = state => state === 'blocker' ? 'Blocker' : state === 'needs_attention' ? 'Needs attention' : 'Ready';

export function CommercialReadinessCard({ readiness, loading = false, error = '', onResolve, onStartFirstCvr }) {
  const workflow = (readiness?.items || []).filter(item => item.workflowState);
  const blockers = (readiness?.items || []).filter(item => !item.workflowState && item.state === 'blocker');
  const attention = (readiness?.items || []).filter(item => !item.workflowState && item.state === 'needs_attention');
  const issues = [...blockers, ...attention];
  const renderItem = item => <li key={item.key} className={`dev-workspace__setup-item dev-workspace__setup-item--${item.state}`}>
    <span className="dev-workspace__readiness-copy"><strong className="dev-workspace__setup-label">{item.title}</strong><span className="dev-workspace__setup-detail">{item.reason}</span></span>
    {item.resolutionTarget ? <button type="button" className="dev-workspace__readiness-action" onClick={() => onResolve?.(item.resolutionTarget)}>{item.workflowState ? 'Continue current CVR' : 'Review'}</button> : null}
  </li>;
  if (readiness && !readiness.hasCvrHistory) {
    const required = readiness.items.filter(item => item.draftCreationRequirement || (item.blocksDraftCreation && !item.workflowState));
    const requiredKeys = new Set(required.map(item => item.key));
    const later = readiness.items.filter(item => !requiredKeys.has(item.key) && !item.workflowState && item.state !== 'ready');
    const renderFirstItem = (item, requiredItem = false) => <li key={item.key} className={`dev-workspace__setup-item dev-workspace__setup-item--${item.state}`}>
      <span className="dev-workspace__readiness-copy">
        <strong className="dev-workspace__setup-label">{item.title}</strong>
        <span className="dev-workspace__setup-detail">{item.state === 'ready' && requiredItem ? 'Complete' : item.reason}</span>
      </span>
      {item.state !== 'ready' && item.resolutionTarget ? <button type="button" className="dev-workspace__readiness-action" onClick={() => onResolve?.(item.resolutionTarget)}>Review</button> : null}
    </li>;
    return <section className="po-module-card dev-workspace__section dev-workspace__first-cvr" aria-label="Get ready for first CVR">
      <h2 className="po-matrix-section__title">Get ready for first CVR</h2>
      {loading ? <p role="status">Checking commercial readiness…</p> : null}
      {error ? <div className="po-list-feedback po-list-feedback--error" role="alert">{error}</div> : null}
      {!loading && !error ? <>
        <h3 className="dev-workspace__readiness-heading">Required to start</h3>
        <ul className="dev-workspace__setup-list">{required.map(item => renderFirstItem(item, true))}</ul>
        {readiness.canCreateFirstCvr ? <div className="dev-workspace__first-cvr-ready">
          <strong>Ready to create the first working CVR</strong>
          <button type="button" className="po-btn-primary" onClick={onStartFirstCvr}>Start first CVR</button>
        </div> : <p>Complete the required items above before starting P01.</p>}
        {later.length ? <>
          <h3 className="dev-workspace__readiness-heading">Check before submission</h3>
          <p className="dev-workspace__setup-detail">These items do not prevent you starting a working Draft. Check what applies before the appropriate Submit or Lock stage.</p>
          <ul className="dev-workspace__setup-list">{later.map(item => renderFirstItem(item))}</ul>
        </> : null}
      </> : null}
    </section>;
  }
  return <section className="po-module-card dev-workspace__section" aria-label="Commercial readiness">
    <h2 className="po-matrix-section__title">Commercial readiness</h2>
    {loading ? <p role="status">Checking commercial readiness…</p> : null}
    {error ? <div className="po-list-feedback po-list-feedback--error" role="alert">{error}</div> : null}
    {!loading && !error && readiness ? <>
      <p className={`po-status-badge po-status-badge--${readiness.overallState === 'blocker' ? 'danger' : readiness.overallState === 'needs_attention' ? 'warning' : 'success'}`}>{readinessLabel(readiness.overallState)}</p>
      <p>{workflow.length
        ? `${workflow[0].openPeriod?.periodKey || 'A CVR'} is in progress.`
        : readiness.canCreateFirstCvr
          ? readiness.hasCvrHistory ? 'Ready to create the next working CVR.' : 'Ready to create the first working CVR.'
          : readiness.hasCvrHistory ? 'Another CVR period cannot be created at present.' : 'Resolve the creation blockers before starting the first CVR.'}</p>
      {workflow.length ? <ul className="dev-workspace__setup-list dev-workspace__readiness-workflow">{workflow.map(renderItem)}</ul> : null}
      {issues.length ? <>
        {blockers.length ? <h3 className="dev-workspace__readiness-heading">{blockers.length} {blockers.length === 1 ? 'blocker' : 'blockers'}</h3> : null}
        {blockers.length ? <ul className="dev-workspace__setup-list">{blockers.map(renderItem)}</ul> : null}
        {attention.length ? <h3 className="dev-workspace__readiness-heading">{attention.length} {attention.length === 1 ? 'item' : 'items'} to review</h3> : null}
        {attention.length ? <ul className="dev-workspace__setup-list">{attention.map(renderItem)}</ul> : null}
      </> : <p>No commercial readiness issues require attention.</p>}
    </> : null}
  </section>;
}

function buildOpenPackageLabel(pkg) {
  const supplier = pkg.supplierLabel || 'supplier';
  const costCode = pkg.costCode || 'package';
  return `Open package for ${supplier}, cost code ${costCode}`;
}

export function PackageTable({
  packages,
  onOpenPackage,
  packageError = null,
  loading = false,
  commercialEventsLoading = false,
  commercialEventsError = '',
  matricesError = '',
}) {
  if (loading) {
    return <p className="dev-workspace__section-lead">Loading packages…</p>;
  }

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
      {commercialEventsError ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {commercialEventsError}
        </div>
      ) : null}
      {matricesError ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {matricesError}
        </div>
      ) : null}
      <div className="po-table-wrap dev-workspace__packages-wrap">
        <table className="po-data-table dev-workspace__packages-table">
          <colgroup>
            <col className="dev-workspace__packages-col dev-workspace__packages-col--supplier" />
            <col className="dev-workspace__packages-col dev-workspace__packages-col--cost-code" />
            <col className="dev-workspace__packages-col dev-workspace__packages-col--approved" />
            <col className="dev-workspace__packages-col dev-workspace__packages-col--approved" />
            <col className="dev-workspace__packages-col dev-workspace__packages-col--current" />
            <col className="dev-workspace__packages-col dev-workspace__packages-col--action" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Supplier</th>
              <th scope="col">Cost code</th>
              <th scope="col" className="dev-workspace__packages-num">
                <abbr title="Approved uninstructed commercial events">Uninstructed</abbr>
              </th>
              <th scope="col" className="dev-workspace__packages-num">
                <abbr title="Issued Variation Orders">Issued VOs</abbr>
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
              const commercialValuesPending =
                commercialEventsLoading || commercialDisplay.commercialEventsReady === false;
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
                    {commercialValuesPending
                      ? 'Loading commercial data…'
                      : formatSignedDisplayMoney(
                          commercialDisplay.approvedCommercialEventMovement
                        )}
                  </span>
                </td>
                <td className="dev-workspace__packages-num">
                  <span className="dev-workspace__packages-money">
                    {commercialValuesPending ? 'Loading commercial data…' : formatSignedDisplayMoney(commercialDisplay.issuedVariationOrderMovement || 0)}
                  </span>
                </td>
                <td className="dev-workspace__packages-num">
                  <span className="dev-workspace__packages-money">
                    {commercialValuesPending
                      ? 'Loading commercial data…'
                      : formatDisplayMoney(commercialDisplay.currentPackageValue)}
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

export default function DevelopmentOverview({
  model,
  onOpenPackage,
  packageError = null,
  packagesLoading = false,
  commercialEventsLoading = false,
  commercialEventsError = '',
  matricesLoading = false,
  matricesError = '',
  commercialReadiness = null,
  commercialReadinessLoading = false,
  commercialReadinessError = '',
  onResolveReadiness,
  onStartFirstCvr,
}) {
  if (!model) return null;

  return (
    <>
      <div className="dev-workspace__grid">
        <CommercialReadinessCard readiness={commercialReadiness} loading={commercialReadinessLoading} error={commercialReadinessError} onResolve={onResolveReadiness} onStartFirstCvr={onStartFirstCvr} />

        <section className="po-module-card dev-workspace__section">
          <h2 className="po-matrix-section__title">Packages</h2>
          <PackageTable
            packages={model.packages}
            onOpenPackage={onOpenPackage}
            packageError={packageError}
            loading={packagesLoading}
            commercialEventsLoading={commercialEventsLoading}
            commercialEventsError={commercialEventsError}
            matricesLoading={matricesLoading}
            matricesError={matricesError}
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
  packagesLoading = false,
  commercialEventsLoading = false,
  commercialEventsError = '',
  matricesLoading = false,
  matricesError = '',
}) {
  return (
    <section className="po-module-card dev-workspace__section">
      <h2 className="po-matrix-section__title">Packages</h2>
      <PackageTable
        packages={model?.packages}
        onOpenPackage={onOpenPackage}
        packageError={packageError}
        loading={packagesLoading}
        commercialEventsLoading={commercialEventsLoading}
        commercialEventsError={commercialEventsError}
        matricesLoading={matricesLoading}
        matricesError={matricesError}
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
