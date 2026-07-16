import { useEffect } from 'react';

export function RevenueToast({ message, onDismiss }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => onDismiss?.(), 6000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div className="revenue-toast" role="status" aria-live="polite">
      <p className="revenue-toast__message">{message}</p>
      <button type="button" className="revenue-toast__dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

export function RevenueProgressPanel({ progress }) {
  if (!progress) return null;

  const steps = progress.steps || [];
  const isComplete = progress.complete;

  return (
    <div className="revenue-progress" role="status" aria-live="polite">
      {!isComplete ? (
        <p className="revenue-progress__heading">{progress.label || 'Updating Revenue Strategy...'}</p>
      ) : (
        <p className="revenue-progress__heading revenue-progress__heading--complete">Completed</p>
      )}
      <ul className="revenue-progress__steps">
        {steps.map((step) => (
          <li
            key={step.key}
            className={`revenue-progress__step revenue-progress__step--${step.status}`}
          >
            {step.status === 'done' ? <span aria-hidden="true">✔</span> : null}
            {step.status === 'active' ? <span className="revenue-progress__spinner" aria-hidden="true" /> : null}
            <span>{step.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RevenueConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  secondaryLabel = null,
  onCancel,
  onConfirm,
  onSecondary,
  busy = false,
}) {
  if (!open) return null;

  return (
    <div className="revenue-bulk-backdrop" role="presentation" onClick={busy ? undefined : onCancel}>
      <div
        className="revenue-bulk-dialog modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="revenue-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="revenue-confirm-title">{title}</h3>
        {message ? <p>{message}</p> : null}
        <div className="modal-actions revenue-bulk-dialog__actions">
          <button
            type="button"
            className="po-list-btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          {secondaryLabel ? (
            <button
              type="button"
              className="po-list-btn-secondary"
              onClick={onSecondary}
              disabled={busy}
            >
              {secondaryLabel}
            </button>
          ) : null}
          <button type="button" className="po-btn-primary" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export const REVENUE_PROGRESS_STEPS = [
  { key: 'house-types', label: 'House Types updated', status: 'pending' },
  { key: 'plots', label: 'Plot forecasts updated', status: 'pending' },
  { key: 'kpis', label: 'KPIs refreshed', status: 'pending' },
];

export async function animateProgressSteps(setProgress, label) {
  const steps = REVENUE_PROGRESS_STEPS.map((step) => ({ ...step, status: 'pending' }));

  setProgress({ label, complete: false, steps: [...steps] });
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  for (let index = 0; index < steps.length; index += 1) {
    steps[index] = { ...steps[index], status: 'active' };
    setProgress({ label, complete: false, steps: [...steps] });
    await new Promise((resolve) => window.setTimeout(resolve, 16));
    steps[index] = { ...steps[index], status: 'done' };
    setProgress({ label, complete: false, steps: [...steps] });
  }

  setProgress({ label, complete: true, steps: [...steps] });
}
