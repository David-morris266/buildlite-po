import BatchApprovalQueue from './BatchApprovalQueue';

export default function BatchApprovalShell({
  title = 'Finance Director Approval',
  lead = 'Review and approve multiple commercial documents from one screen.',
  queueTitle,
  queueLead,
  items = [],
  selectedIds = [],
  onToggleItem,
  onToggleAll,
  onBack,
  actions = null,
  summary = null,
}) {
  return (
    <div className="batch-approval-shell">
      <header className="batch-approval-shell__header">
        {onBack ? (
          <button type="button" className="po-cert-detail__back" onClick={onBack}>
            Back
          </button>
        ) : null}
        <div>
          <p className="batch-approval-shell__eyebrow">Batch approval (preparation)</p>
          <h1 className="batch-approval-shell__title">{title}</h1>
          <p className="batch-approval-shell__lead">{lead}</p>
        </div>
        {actions ? <div className="batch-approval-shell__actions">{actions}</div> : null}
      </header>

      {summary ? (
        <section className="po-module-card batch-approval-shell__summary">{summary}</section>
      ) : null}

      <BatchApprovalQueue
        title={queueTitle}
        lead={queueLead}
        items={items}
        selectedIds={selectedIds}
        onToggleItem={onToggleItem}
        onToggleAll={onToggleAll}
      />

      <p className="batch-approval-shell__note">
        Batch approval execution will be enabled in a future sprint. This screen prepares the reusable queue components only.
      </p>
    </div>
  );
}
