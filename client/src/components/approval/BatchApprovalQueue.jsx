import { BATCH_APPROVAL_STATUS } from './approvalTypes';

function formatAmount(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString(undefined, {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
  });
}

export default function BatchApprovalQueue({
  title = 'Approval queue',
  lead = 'Select items to prepare for batch approval.',
  items = [],
  selectedIds = [],
  onToggleItem,
  onToggleAll,
  emptyMessage = 'No items are ready for approval.',
}) {
  const allSelected = items.length > 0 && selectedIds.length === items.length;

  return (
    <section className="po-module-card batch-approval-queue">
      <header className="batch-approval-queue__header">
        <div>
          <h2 className="admin-panel__title">{title}</h2>
          <p className="admin-page-header__lead">{lead}</p>
        </div>
        {items.length ? (
          <label className="batch-approval-queue__select-all">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(event) => onToggleAll?.(event.target.checked)}
            />
            <span>Select all</span>
          </label>
        ) : null}
      </header>

      {!items.length ? (
        <p className="batch-approval-queue__empty">{emptyMessage}</p>
      ) : (
        <ul className="batch-approval-queue__list">
          {items.map((item) => {
            const selected = selectedIds.includes(item.id);
            const pending = item.status === BATCH_APPROVAL_STATUS.PENDING;

            return (
              <li
                key={item.id}
                className={`batch-approval-queue__item${selected ? ' batch-approval-queue__item--selected' : ''}`}
              >
                <label className="batch-approval-queue__item-main">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={!pending}
                    onChange={() => onToggleItem?.(item.id)}
                  />
                  <div>
                    <strong>{item.title}</strong>
                    {item.subtitle ? <span>{item.subtitle}</span> : null}
                  </div>
                </label>
                <div className="batch-approval-queue__item-meta">
                  <span>{formatAmount(item.amount)}</span>
                  <span className={`po-status-badge po-status-badge--${pending ? 'pending' : 'approved'}`}>
                    {pending ? 'Pending approval' : item.status}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
