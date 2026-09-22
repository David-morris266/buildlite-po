import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  REPORTING_PERIOD_STATES,
  classifyReportingPeriod,
  formatReportingPeriod,
  isValidReportingYearMonth,
} from '../cvr/cvrReportingMonth';

export default function CvrReportingMonthDialog({
  open = false,
  nextPeriodKey = '',
  suggestedMonth = '',
  busy = false,
  currentDate,
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
  const reportingPeriodState = valid ? classifyReportingPeriod(value, currentDate) : null;
  const closed = reportingPeriodState === REPORTING_PERIOD_STATES.CLOSED;
  const createLabel = nextPeriodKey ? `Create ${nextPeriodKey}` : 'Create period';
  const availabilityMessage = reportingPeriodState === REPORTING_PERIOD_STATES.CURRENT
    ? `${formatReportingPeriod(value)} is still the current open month. Its CVR can be created after month end.`
    : reportingPeriodState === REPORTING_PERIOD_STATES.FUTURE
      ? `${formatReportingPeriod(value)} is in the future. Select a closed commercial month.`
      : '';

  function handleConfirm() {
    if (busy) return;
    if (!valid || !closed) {
      setError(availabilityMessage || 'Select a closed Reporting Period before creating the CVR.');
      return;
    }
    onConfirm?.(value);
  }

  return createPortal(
    <div className="dev-cvr-add-backdrop" role="presentation">
      <div className="dev-cvr-add modal" role="dialog" aria-modal="true" aria-labelledby="cvr-reporting-month-title">
        <h3 id="cvr-reporting-month-title">Reporting Period</h3>
        <p className="dev-cvr-add__lead">
          Select the closed commercial month this CVR reports. The CVR may be created, submitted and approved after that month has ended.
        </p>
        <p className="dev-cvr-add__lead">Ensure actuals and commercial information are complete for this period before Submit.</p>
        <label className="dev-form__field">
          <span className="dev-form__label">Reporting Period</span>
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
        {!error && availabilityMessage ? <p className="dev-cvr-add__error" role="status">{availabilityMessage}</p> : null}
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
            disabled={busy || !valid || !closed}
          >
            {createLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
