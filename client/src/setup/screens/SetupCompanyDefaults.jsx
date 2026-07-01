import { useEffect, useId, useMemo, useState } from "react";
import { SETUP_FORM_IDS } from "../constants";
import { formatDefaultsSummary } from "../setupDraft";
function ChoiceField({ id, label, error, children }) {
  return (
    <div className={`setup-field${error ? " setup-field--error" : ""}`}>
      <label className="setup-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="setup-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
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
        <p className="setup-step__eyebrow">Company defaults</p>
        <h1 className="setup-step__title">How you usually trade</h1>
        <p className="setup-step__lead">
          We&apos;ve selected sensible defaults — adjust anything that
          doesn&apos;t match how your company works. You can change these on
          individual orders later.
        </p>
      </header>

      <form
        id={SETUP_FORM_IDS.defaults}
        className="setup-form setup-form__card setup-defaults"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="setup-form__row">
          <ChoiceField id={`${formId}-vatRate`} label="Default VAT rate">
            <select
              id={`${formId}-vatRate`}
              className="setup-input setup-select"
              value={value.vatRate}
              onChange={set("vatRate")}
            >
              <option value={0.2}>20% — Standard rate</option>
              <option value={0.05}>5% — Reduced rate</option>
              <option value={0}>0% — Zero-rated</option>
            </select>
          </ChoiceField>

          <ChoiceField id={`${formId}-retentionRate`} label="Default retention">
            <select
              id={`${formId}-retentionRate`}
              className="setup-input setup-select"
              value={value.retentionRate}
              onChange={set("retentionRate")}
            >
              <option value={0}>None</option>
              <option value={0.025}>2.5%</option>
              <option value={0.05}>5%</option>
              <option value={0.075}>7.5%</option>
              <option value={0.1}>10%</option>
            </select>
          </ChoiceField>
        </div>

        <div className="setup-form__row">
          <ChoiceField id={`${formId}-paymentTerms`} label="Default payment terms">
            <select
              id={`${formId}-paymentTerms`}
              className="setup-input setup-select"
              value={value.paymentTerms}
              onChange={set("paymentTerms")}
            >
              <option value="on_receipt">Due on receipt</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="45">45 days</option>
              <option value="60">60 days</option>
            </select>
          </ChoiceField>

          <ChoiceField id={`${formId}-currency`} label="Default currency">
            <select
              id={`${formId}-currency`}
              className="setup-input setup-select"
              value={value.currency}
              onChange={set("currency")}
            >
              <option value="GBP">GBP — British pound</option>
              <option value="EUR">EUR — Euro</option>
              <option value="USD">USD — US dollar</option>
            </select>
          </ChoiceField>
        </div>

        <ChoiceField
          id={`${formId}-poNumberPrefix`}
          label="Purchase order numbering"
        >
          <select
            id={`${formId}-poNumberPrefix`}
            className="setup-input setup-select"
            value={value.poNumberPrefix}
            onChange={set("poNumberPrefix")}
          >
            <option value="type">By order type (M0001, S0001…)</option>
            <option value="PO-">PO-0001</option>
            <option value="custom">Custom prefix…</option>
          </select>
        </ChoiceField>

        {value.poNumberPrefix === "custom" ? (
          <ChoiceField
            id={`${formId}-poNumberPrefixCustom`}
            label="Your prefix"
            error={showError("poNumberPrefixCustom")}
          >
            <input
              id={`${formId}-poNumberPrefixCustom`}
              className="setup-input"
              type="text"
              value={value.poNumberPrefixCustom}
              onChange={set("poNumberPrefixCustom")}
              placeholder="e.g. BL-"
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
