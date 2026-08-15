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

  if (pkg.matrixReady === false) {
    return (
      <div className="po-package-overview">
        <section className="po-module-card po-package-next" role="status">
          <h2 className="po-matrix-section__title">
            {pkg.matrixLoadState === 'error'
              ? 'Unable to load order matrix'
              : 'Loading matrix data…'}
          </h2>
          <p className="po-package-next__lead">
            {pkg.matrixLoadState === 'error'
              ? pkg.matrixError?.message ||
                'Order matrix data could not be loaded. Please try again.'
              : 'Loading matrix data…'}
          </p>
        </section>
      </div>
    );
  }

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

      <PackageRecoveryPosition summary={pkg.recoverySummary} />

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

export function PackageRecoveryPosition({ summary }) {
  if (!summary?.hasRecoveries) {
    return (
      <section
        className="po-module-card po-package-recovery po-package-recovery--empty"
        aria-label="Recovery position"
      >
        <h2 className="po-matrix-section__title po-package-recovery__title">Recovery Position</h2>
        <p className="po-package-empty-note">
          No recovery or contra charge events on this package.
        </p>
      </section>
    );
  }

  return (
    <section className="po-module-card po-package-recovery" aria-label="Recovery position">
      <h2 className="po-matrix-section__title po-package-recovery__title">Recovery Position</h2>
      <dl className="po-package-recovery__grid">
        <div>
          <dt>Outstanding</dt>
          <dd>{formatDisplayMoney(summary.outstandingRecoveries)}</dd>
        </div>
        <div>
          <dt>Recovered</dt>
          <dd>{formatDisplayMoney(summary.recoveredValue)}</dd>
        </div>
        <div>
          <dt>Written off</dt>
          <dd>{formatDisplayMoney(summary.writtenOff)}</dd>
        </div>
        <div>
          <dt>
            <abbr title="Recovery or contra charge records not yet fully recovered, closed, or written off. Includes draft and submitted records.">
              Recovery records open
            </abbr>
          </dt>
          <dd>{summary.openRecoveryItems}</dd>
        </div>
      </dl>
    </section>
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

export function SubcontractPackageDashboard({
  pkg,
  compact = false,
  commercialEventsLoading = false,
  commercialEventsReady = true,
}) {
  if (!pkg) return null;

  const commercialValuesPending =
    commercialEventsLoading ||
    commercialEventsReady === false ||
    pkg.commercialEventsReady === false;

  const formatCommercialMoney = (value, signed = false) => {
    if (commercialValuesPending) return 'Loading commercial data…';
    return signed ? formatSignedDisplayMoney(value) : formatDisplayMoney(value);
  };

  const progressTitle =
    'Gross certified ÷ current contract. Approved commercial events increase contract value but are not yet certifiable on certificates until BL-025.2+.';

  const cards = compact
    ? [
        {
          label: 'Original order',
          value: formatDisplayMoney(pkg.originalOrderValue),
          modifier: 'default',
        },
        {
          label: 'Approved events',
          value: formatCommercialMoney(pkg.approvedCommercialMovement, true),
          modifier: pkg.approvedCommercialMovement >= 0 ? 'default' : 'accent',
        },
        {
          label: 'Current contract',
          value: formatCommercialMoney(pkg.currentContractValue),
          modifier: 'accent',
        },
        {
          label: 'Certified gross',
          value: formatDisplayMoney(pkg.certifiedGrossToDate),
          modifier: 'muted',
        },
        {
          label: 'Remaining',
          value: commercialValuesPending
            ? 'Loading commercial data…'
            : formatDisplayMoney(Math.max(0, pkg.remainingContractValue ?? 0)),
          modifier: pkg.isOverCertified ? 'accent' : 'default',
        },
      ]
    : [
        {
          label: 'Original order',
          value: formatDisplayMoney(pkg.originalOrderValue),
          modifier: 'default',
        },
        {
          label: 'Approved events',
          value: formatCommercialMoney(pkg.approvedCommercialMovement, true),
          modifier: pkg.approvedCommercialMovement >= 0 ? 'default' : 'accent',
        },
        {
          label: 'Current contract',
          value: formatCommercialMoney(pkg.currentContractValue),
          modifier: 'accent',
        },
        {
          label: 'Pending events',
          value: formatCommercialMoney(pkg.pendingCommercialMovement),
          modifier: 'muted',
        },
        {
          label: 'Certified gross',
          value: formatDisplayMoney(pkg.certifiedGrossToDate),
          modifier: 'muted',
        },
        {
          label: 'Remaining',
          value: commercialValuesPending
            ? 'Loading commercial data…'
            : formatDisplayMoney(Math.max(0, pkg.remainingContractValue ?? 0)),
          modifier: pkg.isOverCertified ? 'accent' : 'default',
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
      {!compact && pkg.certifiedNetPaymentToDate > 0 ? (
        <p className="po-package-dashboard__net-detail">
          Net payment certified to date: {formatDisplayMoney(pkg.certifiedNetPaymentToDate)}
        </p>
      ) : null}
      {pkg.commercialProgressPct > 0 || pkg.certifiedGrossToDate > 0 ? (
        <p className="po-package-dashboard__progress-note">
          <abbr title={progressTitle}>Commercial progress</abbr>:{' '}
          {commercialValuesPending ? 'Loading commercial data…' : `${pkg.commercialProgressPct}%`}
        </p>
      ) : null}
      {pkg.isOverCertified ? (
        <p className="po-package-dashboard__progress-note po-package-dashboard__progress-note--warning">
          Gross certified exceeds current contract by{' '}
          {formatDisplayMoney(Math.abs(pkg.remainingContractValue))}.
        </p>
      ) : null}
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
          <dt>
            <abbr title="Gross certified ÷ current contract. Approved events increase contract value but are not yet certifiable on certificates until BL-025.2+.">
              Commercial progress
            </abbr>
          </dt>
          <dd>{pkg.commercialProgressPct}%</dd>
        </div>
        {pkg.certifiedNetPaymentToDate > 0 ? (
          <div>
            <dt>Net payment certified</dt>
            <dd>{formatDisplayMoney(pkg.certifiedNetPaymentToDate)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Last updated</dt>
          <dd>{formatPoDate(pkg.updatedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}
