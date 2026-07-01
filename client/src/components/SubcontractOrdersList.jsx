import { useEffect, useMemo, useState } from 'react';
import { listPOs } from '../api';
import POPageHeader from './POPageHeader';
import POLoading from './POLoading';
import { formatMoney } from './poDrawerHelpers';
import { buildSubcontractOrdersFromPos } from '../payments/subcontractOrders';

function StatusBadge({ status }) {
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

export default function SubcontractOrdersList({
  refreshToken = 0,
  listFeedback = null,
  onDismissFeedback,
  onOpenPackage,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError('');
        const data = await listPOs({ pageSize: 500, archived: 'false' });
        const items = Array.isArray(data) ? data : data.items || [];
        if (cancelled) return;
        setRows(buildSubcontractOrdersFromPos(items));
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Failed to load Subcontract Orders');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const summary = useMemo(() => {
    const totalCommitted = rows.reduce((sum, row) => sum + row.committedValue, 0);
    return { count: rows.length, totalCommitted };
  }, [rows]);

  return (
    <div className="po-subcontract-orders-page">
      <POPageHeader
        eyebrow="Payment certificates"
        title="Subcontract Orders"
        lead="Commercial packages grouped by project and supplier. Import your plot × stage valuation matrix before raising certificates."
      />

      {listFeedback ? (
        <div
          className={`po-list-feedback po-list-feedback--${listFeedback.type}`}
          role="status"
        >
          {listFeedback.message}
          {onDismissFeedback ? (
            <button
              type="button"
              className="po-list-feedback__dismiss"
              onClick={onDismissFeedback}
              aria-label="Dismiss message"
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? <POLoading message="Loading Subcontract Orders…" /> : null}

      {!loading && !error && rows.length === 0 ? (
        <div className="po-module-card po-empty-state">
          <p className="po-empty-state__message">
            No Subcontract Orders yet. Approve a Subcontract Purchase Order to
            create one automatically.
          </p>
        </div>
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <>
          <p className="po-summary">
            <strong>{summary.count}</strong> subcontract order
            {summary.count === 1 ? '' : 's'} ·{' '}
            <strong>£{formatMoney(summary.totalCommitted)}</strong> committed
          </p>

          <div className="po-table-wrap">
            <table className="po-data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Supplier</th>
                  <th style={{ textAlign: 'right' }}>Committed Value</th>
                  <th style={{ textAlign: 'right' }}>Certified To Date</th>
                  <th style={{ textAlign: 'right' }}>Remaining</th>
                  <th style={{ textAlign: 'center' }}>Certificates</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.orderKey}>
                    <td>{row.projectLabel}</td>
                    <td>{row.supplierLabel}</td>
                    <td style={{ textAlign: 'right' }}>
                      £{formatMoney(row.committedValue)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      £{formatMoney(row.certifiedToDate)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      £{formatMoney(row.remaining)}
                    </td>
                    <td style={{ textAlign: 'center' }}>{row.certificateCount}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="po-list-btn-primary"
                        onClick={() => onOpenPackage(row.orderKey)}
                      >
                        Open Package
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
