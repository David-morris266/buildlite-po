import { useEffect, useState } from 'react';
import { isValidReportingYearMonth } from '../cvr/cvrReportingMonth';

export default function CvrReportingMonthDialog({
  open = false,
  nextPeriodKey = '',
  suggestedMonth = '',
  busy = false,
  onCancel,
  onConfirm,
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setValue(isValidReportingYearMonth(suggestedMonth) ? suggestedMonth : '');
    setError('');
  }, [open, suggestedMonth]);

  if (!open) return null;

  const valid = isValidReportingYearMonth(value);
  const createLabel = nextPeriodKey ? `Create ${nextPeriodKey}` : 'Create period';

  function handleConfirm() {
    if (busy) return;
    if (!valid) {
      setError('Select a reporting month (YYYY-MM) before creating the CVR.');
      return;
    }
    onConfirm?.(value);
  }

  return (
    <div className="dev-cvr-add-backdrop" role="presentation">
      <div className="dev-cvr-add modal" role="dialog" aria-modal="true" aria-labelledby="cvr-reporting-month-title">
        <h3 id="cvr-reporting-month-title">Reporting month</h3>
        <p className="dev-cvr-add__lead">
          This sets the month-end cut-off for the CVR and future time-based forecasts.
        </p>
        <label className="dev-form__field">
          <span className="dev-form__label">Reporting month</span>
          <input
            className="input"
            type="month"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError('');
            }}
            disabled={busy}
            aria-invalid={Boolean(error) || (!valid && Boolean(value))}
          />
        </label>
        {error ? (
          <p className="dev-cvr-add__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dev-cvr-add__actions modal-actions">
          <button
            type="button"
            className="po-list-btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="po-btn-primary"
            onClick={handleConfirm}
            disabled={busy || !valid}
          >
            {createLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
