import {
  canReviewAndApprovePo,
  canSendPoForApproval,
  getPoApproverDisplayName,
} from '../setup/setupDraft';
import { resolvePoDevelopment } from '../developments/developmentPoHelpers';
import { formatPlotsSummary } from '../developments/developmentHelpers';
import {
  formatMoney,
  formatPoDate,
  getApprovalTimelineEntries,
  getCommercialSummary,
  getDrawerHeaderMeta,
  getPoDisplayStatus,
} from './poDrawerHelpers';
import OrderMatrixDrawerSection from './OrderMatrixDrawerSection';

function DrawerSection({ title, children, className = '' }) {
  return (
    <section className={`po-drawer-section${className ? ` ${className}` : ''}`}>
      <h3 className="po-drawer-section__title">{title}</h3>
      {children}
    </section>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="po-drawer-detail">
      <span className="po-drawer-detail__label">{label}</span>
      <span className="po-drawer-detail__value">{value || '—'}</span>
    </div>
  );
}

function CommercialGrid({ summary, compact = false }) {
  return (
    <dl
      className={`po-drawer-commercial${compact ? ' po-drawer-commercial--compact' : ''}`}
    >
      <div className="po-drawer-commercial__item">
        <dt>Net</dt>
        <dd>£{formatMoney(summary.net)}</dd>
      </div>
      <div className="po-drawer-commercial__item">
        <dt>VAT</dt>
        <dd>£{formatMoney(summary.vat)}</dd>
      </div>
      <div className="po-drawer-commercial__item po-drawer-commercial__item--highlight">
        <dt>Gross</dt>
        <dd>£{formatMoney(summary.gross)}</dd>
      </div>
      <div className="po-drawer-commercial__item">
        <dt>Retention</dt>
        <dd>{summary.retentionPct}</dd>
      </div>
      <div className="po-drawer-commercial__item">
        <dt>Order Type</dt>
        <dd>{summary.orderType}</dd>
      </div>
      <div className="po-drawer-commercial__item">
        <dt>Payment Terms</dt>
        <dd>{summary.paymentTerms}</dd>
      </div>
    </dl>
  );
}

function ApprovalTimeline({ entries }) {
  if (!entries.length) {
    return (
      <p className="po-drawer-empty-note">No approval activity recorded yet.</p>
    );
  }

  return (
    <ol className="po-drawer-timeline">
      {entries.map((entry, index) => (
        <li
          key={entry.id}
          className={`po-drawer-timeline__item po-drawer-timeline__item--${entry.modifier}`}
        >
          <div className="po-drawer-timeline__marker" aria-hidden="true">
            {entry.modifier === 'rejected' ? '✕' : '✓'}
          </div>
          <div className="po-drawer-timeline__content">
            <p className="po-drawer-timeline__label">{entry.label}</p>
            <p className="po-drawer-timeline__meta">{entry.when}</p>
            <p className="po-drawer-timeline__by">{entry.by}</p>
            {entry.note ? (
              <p className="po-drawer-timeline__note">{entry.note}</p>
            ) : null}
          </div>
          {index < entries.length - 1 ? (
            <div className="po-drawer-timeline__connector" aria-hidden="true" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function ItemsTable({ items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return (
      <p className="po-drawer-empty-note">No line items on this order.</p>
    );
  }

  const lineTotal = items.reduce((sum, it) => {
    const qty = Number(it.qty ?? it.quantity ?? 0);
    const rate = Number(it.rate ?? it.unitRate ?? 0);
    const amount =
      it.amount != null ? Number(it.amount) : qty * rate;
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  return (
    <div className="po-drawer-items">
      <div className="po-table-wrap">
        <table className="po-data-table po-drawer-items__table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Rate</th>
              <th style={{ textAlign: 'right' }}>Line total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const qty = Number(it.qty ?? it.quantity ?? 0);
              const rate = Number(it.rate ?? it.unitRate ?? 0);
              const total =
                it.total ??
                it.amount ??
                qty * rate;
              return (
                <tr key={i}>
                  <td>{it.description || '—'}</td>
                  <td>{it.qty ?? it.quantity ?? '—'}</td>
                  <td>£{formatMoney(rate)}</td>
                  <td style={{ textAlign: 'right' }}>£{formatMoney(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="po-drawer-items__total">
        <span>Items total</span>
        <strong>£{formatMoney(lineTotal)}</strong>
      </div>
    </div>
  );
}

export default function POReviewDrawerContent({
  po,
  feedback = null,
  updatingApproval = false,
  onClose,
  onDownloadPdf,
  onEdit,
  onDelete,
  onSendForApproval,
  onApprove,
  onReject,
  canEdit = false,
  onOpenPackage,
}) {
  if (!po) return null;

  const status = getPoDisplayStatus(po);
  const summary = getCommercialSummary(po);
  const timeline = getApprovalTimelineEntries(po);
  const headerMeta = getDrawerHeaderMeta(po);
  const showApproverActions = canReviewAndApprovePo(po);
  const showSendForApproval = canSendPoForApproval(po);

  const supplierName =
    po.supplierSnapshot?.name ||
    po.supplierName ||
    po.supplier ||
    '—';

  const development = resolvePoDevelopment(po);
  const plotsLabel =
    development.plotCount != null
      ? formatPlotsSummary(development.plotCount)
      : '—';

  return (
    <>
      <header className="po-drawer-header">
        <div className="po-drawer-header__bar">
          <p className="po-drawer-header__eyebrow">Purchase order</p>
          <button
            type="button"
            className="po-drawer-header__close"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="po-drawer-header__hero">
          <h2 className="po-drawer-header__number">{po.poNumber}</h2>
          <span
            className={`po-status-badge po-status-badge--${status.modifier}`}
          >
            {status.label}
          </span>
        </div>

        <div className="po-drawer-header__meta">
          <p>{headerMeta.supplier}</p>
          <p>{headerMeta.project}</p>
          <p>{headerMeta.date}</p>
        </div>

        <div className="po-drawer-header__commercial">
          <h3 className="po-drawer-header__commercial-title">
            Commercial Summary
          </h3>
          <CommercialGrid summary={summary} compact />
        </div>
      </header>

      <div className="po-drawer-body">
        {feedback ? (
          <div
            className={`po-list-feedback po-list-feedback--${feedback.type}`}
            role="status"
          >
            {feedback.message}
          </div>
        ) : null}

        <DrawerSection title="Order summary">
          <DetailRow label="Description" value={po.title || po.description} />
          <DetailRow
            label="Created"
            value={formatPoDate(po.createdAt || po.date)}
          />
          <DetailRow label="Cost code" value={po.costRef?.costCode} />
        </DrawerSection>

        <DrawerSection title="Supplier">
          <DetailRow label="Name" value={supplierName} />
          {po.supplierSnapshot?.contactEmail ? (
            <DetailRow label="Email" value={po.supplierSnapshot.contactEmail} />
          ) : null}
          {po.supplierSnapshot?.contactPhone ? (
            <DetailRow label="Phone" value={po.supplierSnapshot.contactPhone} />
          ) : null}
        </DrawerSection>

        <DrawerSection title="Development">
          <DetailRow label="Development" value={development.label} />
          <DetailRow label="Development Number" value={development.number} />
          <DetailRow
            label="Status"
            value={development.statusMeta?.label || '—'}
          />
          <DetailRow label="Client" value={development.client} />
          <DetailRow label="Plots" value={plotsLabel} />
        </DrawerSection>

        <DrawerSection title="Approval">
          {showApproverActions ? (
            <div className="po-drawer-approval-notice" role="status">
              <p className="po-drawer-approval-notice__label">Awaiting decision</p>
              <p className="po-drawer-approval-notice__detail">
                Assigned to{' '}
                <strong>{getPoApproverDisplayName(po)}</strong>
              </p>
            </div>
          ) : null}
          <ApprovalTimeline entries={timeline} />
        </DrawerSection>

        <DrawerSection title="Items">
          <ItemsTable items={po.items} />
        </DrawerSection>

        <OrderMatrixDrawerSection
          po={po}
          onOpenPackage={onOpenPackage}
        />
      </div>

      <footer className="po-drawer-footer">
        {showApproverActions ? (
          <>
            <button
              type="button"
              className="po-btn-primary"
              disabled={updatingApproval}
              onClick={onApprove}
            >
              Approve
            </button>
            <button
              type="button"
              className="po-list-btn-secondary"
              disabled={updatingApproval}
              onClick={onReject}
            >
              Reject
            </button>
            <button
              type="button"
              className="po-drawer-footer__link"
              onClick={onDownloadPdf}
            >
              Download PDF
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="po-btn-primary"
              onClick={onDownloadPdf}
            >
              Download PDF
            </button>
            {canEdit && onEdit ? (
              <button
                type="button"
                className="po-list-btn-secondary"
                onClick={onEdit}
              >
                Edit Purchase Order
              </button>
            ) : null}
            {showSendForApproval && onSendForApproval ? (
              <button
                type="button"
                className="po-list-btn-secondary"
                onClick={onSendForApproval}
              >
                Send for approval
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                className="po-drawer-footer__danger"
                onClick={onDelete}
              >
                Delete
              </button>
            ) : null}
          </>
        )}
        <button
          type="button"
          className="po-drawer-footer__link po-drawer-footer__link--close"
          onClick={onClose}
        >
          Close
        </button>
      </footer>
    </>
  );
}
