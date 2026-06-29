import { countCostCodes, isApprovalReady } from "../setupDraft";

function ChecklistItem({ done, children }) {
  return (
    <li
      className={`setup-checklist__item${
        done ? " setup-checklist__item--done" : ""
      }`}
    >
      <span className="setup-checklist__mark" aria-hidden="true">
        {done ? "✓" : "○"}
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * Live readiness checklist — steps 5–7 (BL-007A.05+).
 */
export default function SetupReadinessChecklist({
  firstOrder,
  approval,
  className = "",
}) {
  const supplierReady = Boolean(String(firstOrder?.supplierName || "").trim());
  const costCodesReady = countCostCodes(firstOrder) > 0;
  const approvalReady = approval ? isApprovalReady(approval) : false;

  return (
    <div
      className={`setup-checklist${className ? ` ${className}` : ""}`}
      aria-live="polite"
    >
      <p className="setup-checklist__label">Your progress</p>
      <ul className="setup-checklist__list">
        <ChecklistItem done>Company ready</ChecklistItem>
        <ChecklistItem done>Branding ready</ChecklistItem>
        <ChecklistItem done>Company defaults</ChecklistItem>
        <ChecklistItem done={supplierReady}>Supplier ready</ChecklistItem>
        <ChecklistItem done={costCodesReady}>Cost codes ready</ChecklistItem>
        <ChecklistItem done={approvalReady}>Approval</ChecklistItem>
      </ul>
    </div>
  );
}
