import { useEffect, useRef } from "react";
import { PO_SAVED_DRAFT_SUPPLIER_PENDING_MESSAGE } from "../suppliers/poRequestApprovalGate";

function SuccessIcon({ compact = false }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={`po-journey-panel__success-icon${compact ? " po-journey-panel__success-icon--compact" : ""}`}
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="22" className="po-journey-panel__success-ring" />
      <path
        d="M14 24l7 7 13-14"
        className="po-journey-panel__success-check"
        fill="none"
      />
    </svg>
  );
}

/**
 * Inline confirmation at the foot of the PO form (BL-010A.01).
 * Replaces the save action area — not a modal.
 */
export default function POSaveJourneyPanel({
  variant,
  poNumber,
  approverName = "",
  approvalMode = "self",
  supplierPendingApproval = false,
  sendingFromDraft = false,
  onContinueEditing,
  onSendForApproval,
  onViewPurchaseOrders,
  onReviewAndApprove,
  onCreateAnother,
  onDismiss,
}) {
  const primaryRef = useRef(null);

  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, [variant]);

  const isDraft = variant === "draft-saved";
  const isSelf = approvalMode === "self";

  const title = supplierPendingApproval
    ? "Purchase Order saved as Draft"
    : isDraft
      ? "Purchase Order saved successfully"
      : "Purchase Order sent for approval";

  const detail = supplierPendingApproval
    ? PO_SAVED_DRAFT_SUPPLIER_PENDING_MESSAGE
    : isDraft
      ? `Purchase Order ${poNumber} has been saved as a Draft.`
      : `Purchase Order ${poNumber} is now waiting for approval.`;

  let nextStepHint;
  let recommendedLabel;
  let primaryLabel;
  let primaryAction;
  let secondaryLabel;
  let secondaryAction;
  let showSecondaryAction = true;

  if (isDraft) {
    nextStepHint = supplierPendingApproval
      ? "Your order is saved as a Draft and has not been sent for approval. Approve the supplier in Administration, then return to send this order for approval."
      : "Your order is saved. You can keep editing, send it for approval, or open it in your list.";
    recommendedLabel = "Recommended next step";
    primaryLabel = "Continue editing";
    primaryAction = onContinueEditing;
    if (supplierPendingApproval) {
      showSecondaryAction = false;
    } else {
      secondaryLabel = sendingFromDraft ? "Sending…" : "Send for Approval";
      secondaryAction = onSendForApproval;
    }
  } else if (isSelf) {
    nextStepHint =
      "You are the approver. Review and approve from Purchase Orders at any time.";
    recommendedLabel = "Recommended next step";
    primaryLabel = "Review";
    primaryAction = onReviewAndApprove;
    secondaryLabel = "View Purchase Orders";
    secondaryAction = onViewPurchaseOrders;
  } else {
    nextStepHint = `${approverName || "Your approver"} will review this order before it can be issued.`;
    recommendedLabel = "Recommended next step";
    primaryLabel = "View Purchase Orders";
    primaryAction = onViewPurchaseOrders;
    secondaryLabel = "Create another Purchase Order";
    secondaryAction = onCreateAnother;
  }

  return (
    <section
      className="po-journey-panel po-journey-panel--inline po-journey-panel--enter"
      role="status"
      aria-live="polite"
      aria-labelledby="po-journey-panel-title"
    >
      <button
        type="button"
        className="po-journey-panel__close"
        onClick={onDismiss}
        aria-label="Dismiss confirmation and return to save actions"
      >
        ×
      </button>

      <div className="po-journey-panel__content">
        <div className="po-journey-panel__summary">
          <SuccessIcon compact />
          <div className="po-journey-panel__copy">
            <p className="po-journey-panel__eyebrow">What just happened</p>
            <h3 id="po-journey-panel-title" className="po-journey-panel__title">
              {title}
            </h3>
            <p className="po-journey-panel__detail">{detail}</p>
            {!isDraft ? (
              <div className="po-journey-panel__waiting">
                <p className="po-journey-panel__waiting-label">
                  Who is responsible for the next step
                </p>
                <p className="po-journey-panel__waiting-name">{approverName}</p>
              </div>
            ) : null}
            <p className="po-journey-panel__hint">{nextStepHint}</p>
          </div>
        </div>

        <div className="po-journey-panel__actions-wrap">
          <p className="po-journey-panel__recommended">{recommendedLabel}</p>
          <div className="po-journey-panel__actions">
            <button
              ref={primaryRef}
              type="button"
              className="po-journey-panel__btn po-journey-panel__btn--primary"
              onClick={primaryAction}
            >
              {primaryLabel}
            </button>
            {showSecondaryAction ? (
              <button
                type="button"
                className="po-journey-panel__btn po-journey-panel__btn--secondary"
                onClick={secondaryAction}
                disabled={isDraft && sendingFromDraft}
              >
                {secondaryLabel}
              </button>
            ) : null}
            {isDraft ? (
              <button
                type="button"
                className="po-journey-panel__link"
                onClick={onViewPurchaseOrders}
              >
                View in Purchase Orders
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
