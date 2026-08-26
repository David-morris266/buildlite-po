import { useEffect, useMemo, useState } from 'react';
import { formatMoney } from './poDrawerHelpers';
import {
  EXPECTED_LIABILITY_TREATMENT_OPTIONS,
  EXPECTED_LIABILITY_TREATMENTS,
  enrichExpectedLiabilityReadModel,
  expectedExceedsSubmitted,
  isEligibleContractValueEvent,
  roundMoney,
  validateExpectedLiabilityIntent,
} from '../commercialEvents/commercialEventExpectedLiability';
import { COMMERCIAL_EVENT_STATUSES } from '../commercialEvents/commercialEventTypes';

function moneyLabel(value) {
  return `£${formatMoney(value)}`;
}

function formMatchesSaved(treatment, amount, reason, read) {
  if (treatment !== read.expectedTreatment) return false;
  if (treatment === EXPECTED_LIABILITY_TREATMENTS.override) {
    const formAmount = amount === '' ? null : roundMoney(Number(amount));
    if (formAmount !== roundMoney(read.expectedAmount)) return false;
  }
  if (treatment !== EXPECTED_LIABILITY_TREATMENTS.default) {
    return String(reason || '').trim() === String(read.expectedReason || '').trim();
  }
  return true;
}

function treatmentHelp(treatment) {
  if (treatment === EXPECTED_LIABILITY_TREATMENTS.override) {
    return 'Enter the QS expected amount. This may be zero, below, equal to, or above the submitted CE value.';
  }
  if (treatment === EXPECTED_LIABILITY_TREATMENTS.hold) {
    return 'Hold keeps expected liability at £0 until you restore Default or Override.';
  }
  if (treatment === EXPECTED_LIABILITY_TREATMENTS.exclude) {
    return 'Exclude keeps expected liability at £0. The CE fact is unchanged.';
  }
  return 'Default follows the full submitted CE value automatically. No extra save is required.';
}

export default function CommercialEventExpectedLiabilityPanel({
  event,
  disabled = false,
  busy = false,
  error = null,
  onApply,
}) {
  const read = useMemo(() => enrichExpectedLiabilityReadModel(event || {}), [event]);
  const editable = Boolean(read.canEditExpectedLiability) && !disabled;
  const [treatment, setTreatment] = useState(read.expectedTreatment);
  const [amount, setAmount] = useState(
    read.expectedAmount != null ? String(read.expectedAmount) : ''
  );
  const [reason, setReason] = useState(read.expectedReason || '');
  const [localErrors, setLocalErrors] = useState([]);

  useEffect(() => {
    setTreatment(read.expectedTreatment);
    setAmount(read.expectedAmount != null ? String(read.expectedAmount) : '');
    setReason(read.expectedReason || '');
    setLocalErrors([]);
  }, [read.id, read.version, read.expectedTreatment, read.expectedAmount, read.expectedReason]);

  if (!event) return null;
  if (!isEligibleContractValueEvent(event)) return null;

  const status = event.status?.key || event.status;
  if (status === COMMERCIAL_EVENT_STATUSES.draft.key) {
    return null;
  }

  const draftAmount =
    treatment === EXPECTED_LIABILITY_TREATMENTS.override
      ? amount === ''
        ? null
        : Number(amount)
      : null;
  const warning =
    treatment === EXPECTED_LIABILITY_TREATMENTS.override &&
    expectedExceedsSubmitted(event, draftAmount);
  const isCurrentDefault = read.expectedTreatment === EXPECTED_LIABILITY_TREATMENTS.default;
  const choosingDefault = treatment === EXPECTED_LIABILITY_TREATMENTS.default;
  const needsApply = editable && (!choosingDefault || !isCurrentDefault);
  const formDirty = !formMatchesSaved(treatment, amount, reason, read);
  const applyEnabled = formDirty && !busy;
  const applyLabel = choosingDefault
    ? 'Restore default'
    : formDirty
      ? 'Save expected treatment'
      : 'Saved';

  function handleApply() {
    if (!formDirty) return;
    const intent = {
      treatment,
      expectedAmount:
        treatment === EXPECTED_LIABILITY_TREATMENTS.override
          ? amount === ''
            ? null
            : Number(amount)
          : undefined,
      reason: choosingDefault ? undefined : reason,
      expectedVersion: event.version,
    };
    const validated = validateExpectedLiabilityIntent(intent, event);
    if (!validated.ok) {
      setLocalErrors(validated.errors);
      return;
    }
    setLocalErrors([]);
    onApply?.(intent);
  }

  const errors = [...localErrors, ...(error ? [error] : [])];

  if (!editable) {
    return (
      <section
        className="po-ce-expected"
        data-testid="ce-expected-liability-readonly"
      >
        <h3>Expected liability</h3>
        <p className="po-ce-expected__inactive">
          Expected liability is inactive at {moneyLabel(0)}. Stored treatment is retained for
          history only.
        </p>
        <dl className="po-ce-expected__facts">
          <div>
            <dt>Potential liability</dt>
            <dd>{moneyLabel(read.potentialLiability)}</dd>
          </div>
          <div>
            <dt>Expected liability</dt>
            <dd>{moneyLabel(read.expectedLiability)}</dd>
          </div>
          <div>
            <dt>Treatment</dt>
            <dd>{read.expectedTreatment}</dd>
          </div>
        </dl>
      </section>
    );
  }

  return (
    <section className="po-ce-expected" data-testid="ce-expected-liability-panel">
      <h3>Expected liability</h3>
      <dl className="po-ce-expected__facts">
        <div>
          <dt>Potential liability</dt>
          <dd>{moneyLabel(read.potentialLiability)}</dd>
        </div>
        <div>
          <dt>Expected liability</dt>
          <dd>{moneyLabel(read.expectedLiability)}</dd>
        </div>
        <div>
          <dt>Treatment</dt>
          <dd>
            {isCurrentDefault
              ? 'Default — full submitted value'
              : read.expectedTreatment}
          </dd>
        </div>
      </dl>

      {isCurrentDefault ? (
        <p className="po-ce-expected__helper" data-testid="ce-expected-default-hint">
          Default follows the submitted CE value automatically. No extra save is required.
        </p>
      ) : null}

      <label className="po-ce-drawer__field po-ce-drawer__field--wide">
        <span>Treatment</span>
        <select
          data-testid="ce-expected-treatment"
          value={treatment}
          disabled={busy}
          onChange={(e) => {
            setTreatment(e.target.value);
            setLocalErrors([]);
          }}
        >
          {EXPECTED_LIABILITY_TREATMENT_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="po-ce-expected__helper">{treatmentHelp(treatment)}</p>

      {treatment === EXPECTED_LIABILITY_TREATMENTS.override ? (
        <label className="po-ce-drawer__field">
          <span>Expected amount</span>
          <input
            data-testid="ce-expected-amount"
            type="number"
            step="0.01"
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
      ) : null}

      {treatment !== EXPECTED_LIABILITY_TREATMENTS.default ? (
        <label className="po-ce-drawer__field po-ce-drawer__field--wide">
          <span>Reason</span>
          <textarea
            data-testid="ce-expected-reason"
            rows={2}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      ) : null}

      {warning ? (
        <p className="po-ce-expected__warning" data-testid="ce-expected-above-warning">
          Expected is above the submitted CE value. This is allowed. The submitted value remains
          potential liability.
        </p>
      ) : null}

      {errors.length ? (
        <ul className="po-ce-expected__errors" data-testid="ce-expected-errors">
          {errors.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}

      {needsApply ? (
        <div className="po-ce-drawer__actions">
          <button
            type="button"
            className="po-btn-primary"
            data-testid="ce-expected-apply"
            disabled={!applyEnabled}
            onClick={handleApply}
          >
            {applyLabel}
          </button>
        </div>
      ) : null}
    </section>
  );
}
