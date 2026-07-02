import { formatMoney, formatPoDate, formatPoDateTime } from './poDrawerHelpers';

function StatusBadge({ status }) {
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

function PlaceholderValue({ money = false, zeroOk = false, value }) {
  if (value == null || value === '') {
    return <span className="po-package-value--empty">—</span>;
  }
  if (money) {
    if (!zeroOk && Number(value) === 0) {
      return <span className="po-package-value--zero">£0.00</span>;
    }
    return <>£{formatMoney(value)}</>;
  }
  return value;
}

export default function SubcontractPackageOverview({
  pkg,
  onOpenMatrix,
}) {
  if (!pkg) return null;

  return (
    <div className="po-package-overview">
      <section className="po-module-card po-package-next">
        <h2 className="po-matrix-section__title">What happens next</h2>
        {pkg.matrixExists ? (
          <>
            <p className="po-package-next__lead">
              Your plot × stage valuation matrix is in place. When you are ready,
              monthly Payment Certificates will update certified values inside
              that layout — without replacing it.
            </p>
            <button
              type="button"
              className="po-list-btn-secondary"
              onClick={() => onOpenMatrix?.()}
            >
              Review Order Matrix
            </button>
          </>
        ) : (
          <>
            <p className="po-package-next__lead">
              Import your existing valuation matrix — plots as rows, payment
              stages as columns. BuildLite preserves the layout you already use
              on site.
            </p>
            <button
              type="button"
              className="po-btn-primary"
              onClick={() => onOpenMatrix?.()}
            >
              Open Order Matrix
            </button>
          </>
        )}
      </section>

      <div className="po-package-overview__grid">
        <section className="po-module-card">
          <h2 className="po-matrix-section__title">Order Matrix status</h2>
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
          <h2 className="po-matrix-section__title">Commercial position</h2>
          <dl className="po-package-facts">
            <div>
              <dt>Committed value</dt>
              <dd>£{formatMoney(pkg.committedValue)}</dd>
            </div>
            <div>
              <dt>Approved variations</dt>
              <dd>
                <PlaceholderValue money zeroOk value={pkg.approvedVariations} />
              </dd>
            </div>
            <div>
              <dt>Adjusted contract</dt>
              <dd>£{formatMoney(pkg.adjustedContract)}</dd>
            </div>
            <div>
              <dt>Certified to date</dt>
              <dd>
                <PlaceholderValue money zeroOk value={pkg.certifiedToDate} />
              </dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd>£{formatMoney(pkg.remaining)}</dd>
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
                  <td style={{ textAlign: 'right' }}>
                    £{formatMoney(po.subtotal ?? po.totals?.net ?? 0)}
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

export function SubcontractPackageDashboard({ pkg }) {
  if (!pkg) return null;

  const cards = [
    {
      label: 'Committed value',
      value: `£${formatMoney(pkg.committedValue)}`,
      modifier: 'default',
    },
    {
      label: 'Approved variations',
      value: '£0.00',
      modifier: 'muted',
    },
    {
      label: 'Adjusted contract',
      value: `£${formatMoney(pkg.adjustedContract)}`,
      modifier: 'default',
    },
    {
      label: 'Certified to date',
      value:
        pkg.certifiedToDate > 0
          ? `£${formatMoney(pkg.certifiedToDate)}`
          : '£0.00',
      modifier: 'muted',
    },
    {
      label: 'Remaining value',
      value: `£${formatMoney(pkg.remaining)}`,
      modifier: 'accent',
    },
    {
      label: 'Overall progress',
      value: `${pkg.overallProgress}%`,
      modifier: 'progress',
    },
    {
      label: 'Status',
      value: pkg.status.label,
      modifier: pkg.status.modifier,
      isBadge: true,
    },
  ];

  return (
    <section className="po-package-dashboard" aria-label="Commercial dashboard">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`po-package-dashboard__card po-package-dashboard__card--${card.modifier}`}
        >
          <span className="po-package-dashboard__label">{card.label}</span>
          {card.isBadge ? (
            <StatusBadge status={pkg.status} />
          ) : (
            <strong className="po-package-dashboard__value">{card.value}</strong>
          )}
        </div>
      ))}
    </section>
  );
}

export function SubcontractPackageSummary({ pkg }) {
  if (!pkg) return null;

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
          <dt>Purchase Orders linked</dt>
          <dd>{pkg.poNumbers?.length ?? pkg.pos?.length ?? 0}</dd>
        </div>
        <div>
          <dt>Committed value</dt>
          <dd>£{formatMoney(pkg.committedValue)}</dd>
        </div>
        <div>
          <dt>Approved variations</dt>
          <dd>£0.00</dd>
        </div>
        <div>
          <dt>Adjusted contract</dt>
          <dd>£{formatMoney(pkg.adjustedContract)}</dd>
        </div>
        <div>
          <dt>Certified to date</dt>
          <dd>£0.00</dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>£{formatMoney(pkg.remaining)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatPoDate(pkg.createdAt)}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>{formatPoDate(pkg.updatedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}
