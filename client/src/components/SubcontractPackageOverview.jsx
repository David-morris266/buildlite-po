import { formatDisplayMoney, formatSignedDisplayMoney, formatPoDate, formatPoDateTime } from './poDrawerHelpers';

function StatusBadge({ status }) {
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

export default function SubcontractPackageOverview({
  pkg,
  onOpenMatrix,
}) {
  if (!pkg) return null;

  return (
    <div className="po-package-overview">
      {!pkg.matrixExists ? (
        <section className="po-module-card po-package-next">
          <h2 className="po-matrix-section__title">Get started</h2>
          <p className="po-package-next__lead">
            Import your plot × stage valuation matrix to unlock payment certificates
            and commercial event tracking for this package.
          </p>
          <button
            type="button"
            className="po-btn-primary"
            onClick={() => onOpenMatrix?.()}
          >
            Open Order Matrix
          </button>
        </section>
      ) : (
        <p className="po-package-overview__hint">
          Order matrix is in place.
          <button
            type="button"
            className="po-package-overview__inline-link"
            onClick={() => onOpenMatrix?.()}
          >
            Review matrix
          </button>
          or continue with certificates and commercial events.
        </p>
      )}

      <div className="po-package-overview__grid">
        <section className="po-module-card">
          <h2 className="po-matrix-section__title">Order Matrix</h2>
          <dl className="po-package-facts">
            <div>
              <dt>Status</dt>
              <dd>{pkg.matrixStatusLabel}</dd>
            </div>
            <div>
              <dt>Layout</dt>
              <dd>
                {pkg.matrixExists
                  ? 'Plot × stage matrix'
                  : 'Awaiting import'}
              </dd>
            </div>
            <div>
              <dt>Plots</dt>
              <dd>{pkg.matrixExists ? pkg.matrixPlotCount ?? '—' : '—'}</dd>
            </div>
            <div>
              <dt>Package status</dt>
              <dd>
                <StatusBadge status={pkg.status} />
              </dd>
            </div>
          </dl>
        </section>

        <section className="po-module-card">
          <h2 className="po-matrix-section__title">Package details</h2>
          <dl className="po-package-facts">
            <div>
              <dt>Supplier</dt>
              <dd>{pkg.supplierLabel}</dd>
            </div>
            <div>
              <dt>Project</dt>
              <dd>{pkg.projectLabel}</dd>
            </div>
            <div>
              <dt>Purchase orders</dt>
              <dd>{pkg.poNumbers?.length ?? pkg.pos?.length ?? 0}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatPoDate(pkg.createdAt)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="po-module-card">
        <h2 className="po-matrix-section__title">Linked Purchase Orders</h2>
        <div className="po-table-wrap">
          <table className="po-data-table">
            <thead>
              <tr>
                <th>PO number</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(pkg.pos || []).map((po) => (
                <tr key={po.poNumber || po.number}>
                  <td>{po.poNumber || po.number}</td>
                  <td>{po.title || po.description || '—'}</td>
                  <td className="po-package-overview__money">
                    {formatDisplayMoney(po.subtotal ?? po.totals?.net ?? 0)}
                  </td>
                  <td>{po.approval?.status || po.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="po-module-card">
        <h2 className="po-matrix-section__title">Latest activity</h2>
        {pkg.activity?.length ? (
          <ol className="po-package-timeline">
            {pkg.activity.slice(0, 8).map((entry) => (
              <li
                key={entry.id}
                className={`po-package-timeline__item po-package-timeline__item--${entry.modifier}`}
              >
                <div className="po-package-timeline__marker" aria-hidden="true">
                  ✓
                </div>
                <div>
                  <p className="po-package-timeline__label">{entry.label}</p>
                  <p className="po-package-timeline__when">
                    {formatPoDateTime(entry.when)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="po-package-empty-note">No activity recorded yet.</p>
        )}
      </section>
    </div>
  );
}

export function SubcontractPackageTabPlaceholder({ title, lead, points = [] }) {
  return (
    <section className="po-module-card po-package-placeholder">
      <h2 className="po-package-placeholder__title">{title}</h2>
      <p className="po-package-placeholder__lead">{lead}</p>
      {points.length ? (
        <ul className="po-package-placeholder__list">
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function SubcontractPackageDashboard({ pkg, compact = false }) {
  if (!pkg) return null;

  const cards = compact
    ? [
        {
          label: 'Original PO commitment',
          value: formatDisplayMoney(pkg.originalPoCommitment),
          modifier: 'default',
        },
        {
          label: 'Approved commercial events',
          value: formatSignedDisplayMoney(pkg.approvedCommercialEventMovement),
          modifier: pkg.approvedCommercialEventMovement >= 0 ? 'default' : 'accent',
        },
        {
          label: 'Current package value',
          value: formatDisplayMoney(pkg.currentPackageValue),
          modifier: 'accent',
        },
        {
          label: 'Certified to date',
          value:
            pkg.certifiedToDate > 0
              ? formatDisplayMoney(pkg.certifiedToDate)
              : '£0',
          modifier: 'muted',
        },
        {
          label: 'Remaining (PO contract)',
          value: formatDisplayMoney(pkg.remaining),
          modifier: 'default',
        },
      ]
    : [
        {
          label: 'Original PO commitment',
          value: formatDisplayMoney(pkg.originalPoCommitment),
          modifier: 'default',
        },
        {
          label: 'Approved commercial events',
          value: formatSignedDisplayMoney(pkg.approvedCommercialEventMovement),
          modifier: pkg.approvedCommercialEventMovement >= 0 ? 'default' : 'accent',
        },
        {
          label: 'Current package value',
          value: formatDisplayMoney(pkg.currentPackageValue),
          modifier: 'accent',
        },
        {
          label: 'Pending commercial events',
          value: formatDisplayMoney(pkg.pendingCommercialEventValue),
          modifier: 'muted',
        },
        {
          label: 'Certified to date',
          value:
            pkg.certifiedToDate > 0
              ? formatDisplayMoney(pkg.certifiedToDate)
              : '£0',
          modifier: 'muted',
        },
        {
          label: 'Remaining (PO contract)',
          value: formatDisplayMoney(pkg.remaining),
          modifier: 'default',
        },
      ];

  return (
    <section
      className={`po-package-dashboard${compact ? ' po-package-dashboard--compact' : ''}`}
      aria-label="Package commercial summary"
    >
      {cards.map((card) => (
        <div
          key={card.label}
          className={`po-package-dashboard__card po-package-dashboard__card--${card.modifier}`}
        >
          <span className="po-package-dashboard__label">{card.label}</span>
          <strong className="po-package-dashboard__value po-package-dashboard__value--money">{card.value}</strong>
        </div>
      ))}
    </section>
  );
}

export function SubcontractPackageSummary({ pkg, compact = false }) {
  if (!pkg || compact) return null;

  return (
    <section className="po-module-card po-package-summary">
      <h2 className="po-matrix-section__title">Package summary</h2>
      <dl className="po-package-summary__grid">
        <div>
          <dt>Supplier</dt>
          <dd>{pkg.supplierLabel}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{pkg.projectLabel}</dd>
        </div>
        <div>
          <dt>Package status</dt>
          <dd>
            <StatusBadge status={pkg.status} />
          </dd>
        </div>
        <div>
          <dt>Overall progress</dt>
          <dd>{pkg.overallProgress}%</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>{formatPoDate(pkg.updatedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}
