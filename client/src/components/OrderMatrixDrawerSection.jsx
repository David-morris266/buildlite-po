import { useEffect, useState } from 'react';
import { listPOs } from '../api';
import { formatMoney } from './poDrawerHelpers';
import {
  buildSubcontractOrdersFromPos,
  getOrderMatrixSummary,
  getSubcontractOrderKeyFromPo,
  isApprovedSubcontractPo,
} from '../payments/subcontractOrders';
import { buildPackageViewModel } from '../payments/subcontractPackage';

function StatusBadge({ status }) {
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

export default function OrderMatrixDrawerSection({
  po,
  onOpenPackage,
}) {
  const [order, setOrder] = useState(null);

  useEffect(() => {
    if (!isApprovedSubcontractPo(po)) {
      setOrder(null);
      return undefined;
    }

    const orderKey = getSubcontractOrderKeyFromPo(po);
    if (!orderKey) {
      setOrder(null);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const data = await listPOs({ pageSize: 500, archived: 'false' });
        const items = Array.isArray(data) ? data : data.items || [];
        const match = buildSubcontractOrdersFromPos(items).find(
          (row) => row.orderKey === orderKey
        );
        if (!cancelled) setOrder(match || null);
      } catch {
        if (!cancelled) setOrder(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [po]);

  if (!isApprovedSubcontractPo(po)) return null;

  const orderKey = getSubcontractOrderKeyFromPo(po);
  if (!orderKey) return null;

  const committed = order?.committedValue ?? 0;
  const summary = getOrderMatrixSummary(orderKey, committed);
  const pkg = order ? buildPackageViewModel(order) : null;

  return (
    <section className="po-drawer-section po-drawer-section--package">
      <h3 className="po-drawer-section__title">Subcontract Package</h3>

      <div className="po-package-drawer">
        <p className="po-package-drawer__lead">
          {summary.hasMatrix
            ? 'Your plot × stage valuation matrix is linked to this package. Open the workspace to review progress.'
            : 'Import your plot × stage valuation matrix to begin certifying against this approved subcontract.'}
        </p>

        {pkg ? (
          <dl className="po-package-drawer__stats">
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={pkg.status} />
              </dd>
            </div>
            <div>
              <dt>Committed</dt>
              <dd>£{formatMoney(pkg.committedValue)}</dd>
            </div>
            <div>
              <dt>Order Matrix</dt>
              <dd>{pkg.matrixStatusLabel}</dd>
            </div>
          </dl>
        ) : null}

        <button
          type="button"
          className="po-list-btn-primary"
          onClick={() => onOpenPackage?.(orderKey)}
        >
          Open Package
        </button>
      </div>
    </section>
  );
}
