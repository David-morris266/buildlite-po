export function CvrWorkflowDialog({
  title,
  children,
  confirmLabel,
  onCancel,
  onConfirm,
  confirmDisabled = false,
  busy = false,
}) {
  return (
    <div className="dev-cvr-add-backdrop" role="presentation">
      <div className="dev-cvr-add modal" role="dialog" aria-modal="true">
        <h3>{title}</h3>
        {children}
        <div className="dev-cvr-add__actions modal-actions">
          <button type="button" className="po-list-btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="po-btn-primary" onClick={onConfirm} disabled={confirmDisabled || busy}>
            {busy ? 'Approving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SiteStartApprovalDialog({
  reference,
  reason,
  onReferenceChange,
  onReasonChange,
  onCancel,
  onConfirm,
  confirmDisabled = false,
  busy = false,
  children,
}) {
  return (
    <CvrWorkflowDialog
      title="Approve & Lock Site Start Budget"
      confirmLabel="Approve & Lock"
      onCancel={onCancel}
      onConfirm={onConfirm}
      confirmDisabled={confirmDisabled || !reference.trim() || !reason.trim()}
      busy={busy}
    >
      <p className="dev-cvr-add__lead">
        The locked EFC by Cost Code becomes the immutable Approved Site Start Budget.
      </p>
      {children}
      <label className="dev-form__field">
        <span className="dev-form__label">Approval reference</span>
        <input className="input" value={reference} onChange={(event) => onReferenceChange(event.target.value)} />
      </label>
      <label className="dev-form__field">
        <span className="dev-form__label">Approval reason</span>
        <textarea className="input" rows={3} value={reason} onChange={(event) => onReasonChange(event.target.value)} />
      </label>
    </CvrWorkflowDialog>
  );
}
