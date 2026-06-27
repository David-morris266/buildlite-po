import { useEffect, useId, useMemo, useState } from "react";
import {
  VAT_RATE_OPTIONS,
  RETENTION_OPTIONS,
  PAYMENT_TERMS_OPTIONS,
  CURRENCY_OPTIONS,
  PO_PREFIX_OPTIONS,
  formatDefaultsSummary,
} from "../setupDraft";

function ChoiceField({ id, label, why, error, children }) {
  return (
    <div className={`setup-field${error ? " setup-field--error" : ""}`}>
      <label className="setup-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {why ? <p className="setup-field__hint">{why}</p> : null}
      {error ? (
        <p className="setup-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function optionWhy(options, value, numeric = false) {
  const match = options.find((option) =>
    numeric ? Number(option.value) === Number(value) : option.value === value
  );
  return match?.why || "";
}

export default function SetupCompanyDefaults({
  value,
  onChange,
  errors = {},
  onSubmit,
}) {
  const formId = useId();
  const [touched, setTouched] = useState(false);
  const summary = useMemo(() => formatDefaultsSummary(value), [value]);

  useEffect(() => {
    if (Object.keys(errors).length) setTouched(true);
  }, [errors]);

  const set = (field) => (event) => {
    const nextValue =
      field === "vatRate" || field === "retentionRate"
        ? parseFloat(event.target.value)
        : event.target.value;
    onChange({ ...value, [field]: nextValue });
  };

  const showError = (field) => (touched ? errors[field] : undefined);

  const handleSubmit = (event) => {
    event.preventDefault();
    setTouched(true);
    onSubmit?.();
  };

  return (
    <div className="setup-step setup-animate-in">
      <header className="setup-step__header">
        <p className="setup-step__eyebrow">How you usually trade</p>
        <h1 className="setup-step__title">Set your usual defaults</h1>
        <p className="setup-step__lead">
          A few choices now means less typing every time you raise a purchase
          order or certificate.
        </p>
      </header>

      <div className="setup-why">
        <p className="setup-why__label">Why we ask</p>
        <p className="setup-why__text">
          Most companies use the same VAT rate, retention and payment terms on
          every order. We&apos;ll pre-fill these for you — and you can override
          them on any individual PO or certificate.
        </p>
      </div>

      <form
        className="setup-form setup-form__card setup-defaults"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="setup-form__row">
          <ChoiceField
            id={`${formId}-vatRate`}
            label="Default VAT rate"
            why={optionWhy(VAT_RATE_OPTIONS, value.vatRate, true)}
          >
            <select
              id={`${formId}-vatRate`}
              className="setup-input setup-select"
              value={value.vatRate}
              onChange={set("vatRate")}
            >
              {VAT_RATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </ChoiceField>

          <ChoiceField
            id={`${formId}-retentionRate`}
            label="Default retention"
            why={optionWhy(RETENTION_OPTIONS, value.retentionRate, true)}
          >
            <select
              id={`${formId}-retentionRate`}
              className="setup-input setup-select"
              value={value.retentionRate}
              onChange={set("retentionRate")}
            >
              {RETENTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </ChoiceField>
        </div>

        <div className="setup-form__row">
          <ChoiceField
            id={`${formId}-paymentTerms`}
            label="Default payment terms"
            why={optionWhy(PAYMENT_TERMS_OPTIONS, value.paymentTerms)}
          >
            <select
              id={`${formId}-paymentTerms`}
              className="setup-input setup-select"
              value={value.paymentTerms}
              onChange={set("paymentTerms")}
            >
              {PAYMENT_TERMS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </ChoiceField>

          <ChoiceField
            id={`${formId}-currency`}
            label="Default currency"
            why={optionWhy(CURRENCY_OPTIONS, value.currency)}
          >
            <select
              id={`${formId}-currency`}
              className="setup-input setup-select"
              value={value.currency}
              onChange={set("currency")}
            >
              {CURRENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </ChoiceField>
        </div>

        <ChoiceField
          id={`${formId}-poNumberPrefix`}
          label="Purchase order numbering"
          why={optionWhy(PO_PREFIX_OPTIONS, value.poNumberPrefix)}
        >
          <select
            id={`${formId}-poNumberPrefix`}
            className="setup-input setup-select"
            value={value.poNumberPrefix}
            onChange={set("poNumberPrefix")}
          >
            {PO_PREFIX_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </ChoiceField>

        {value.poNumberPrefix === "custom" ? (
          <ChoiceField
            id={`${formId}-poNumberPrefixCustom`}
            label="Your prefix"
            why="Letters or numbers only — we'll add the sequence, e.g. LR-0001."
            error={showError("poNumberPrefixCustom")}
          >
            <input
              id={`${formId}-poNumberPrefixCustom`}
              className="setup-input"
              type="text"
              value={value.poNumberPrefixCustom}
              onChange={set("poNumberPrefixCustom")}
              placeholder="e.g. LR-"
              maxLength={8}
              autoComplete="off"
            />
          </ChoiceField>
        ) : null}

        <div className="setup-defaults__summary" aria-live="polite">
          <p className="setup-defaults__summary-label">Your starting point</p>
          <p className="setup-defaults__summary-text">
            {summary.vat} VAT · {summary.retention} retention ·{" "}
            {summary.paymentTerms} · {summary.currency} · PO numbers like{" "}
            <strong>{summary.poNumbers}</strong>
          </p>
        </div>
      </form>
    </div>
  );
}
