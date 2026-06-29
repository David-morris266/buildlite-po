import { useEffect, useId, useMemo, useState } from "react";
import { SETUP_FORM_IDS } from "../constants";
import SetupReadinessChecklist from "../components/SetupReadinessChecklist";
import { countCostCodes, mergeCostCodes } from "../setupDraft";

function Field({ id, label, optional, hint, error, children }) {
  return (
    <div className={`setup-field${error ? " setup-field--error" : ""}`}>
      <label className="setup-field__label" htmlFor={id}>
        {label}
        {optional ? (
          <span className="setup-field__optional">Optional</span>
        ) : null}
      </label>
      {children}
      {hint ? <p className="setup-field__hint">{hint}</p> : null}
      {error ? (
        <p className="setup-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function SetupFirstOrder({
  value,
  onChange,
  errors = {},
  onSubmit,
}) {
  const formId = useId();
  const [touched, setTouched] = useState(false);

  const costCodes = useMemo(
    () => mergeCostCodes(value.starterCostCodes, value.customCostCodes),
    [value.starterCostCodes, value.customCostCodes]
  );
  const costCodeCount = countCostCodes(value);

  useEffect(() => {
    if (Object.keys(errors).length) setTouched(true);
  }, [errors]);

  const showError = (field) => (touched ? errors[field] : undefined);

  const set = (field) => (event) => {
    onChange({ ...value, [field]: event.target.value });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setTouched(true);
    onSubmit?.();
  };

  const handleAddCostCode = () => {
    const code = String(value.pendingCostCode || "").trim();
    const description = String(value.pendingCostDescription || "").trim();

    if (!code || !description) return;

    const exists = costCodes.some(
      (item) => item.code.toLowerCase() === code.toLowerCase()
    );
    if (exists) return;

    onChange({
      ...value,
      customCostCodes: [...(value.customCostCodes || []), { code, description }],
      pendingCostCode: "",
      pendingCostDescription: "",
    });
  };

  return (
    <div className="setup-step setup-step--first-order setup-animate-in">
      <header className="setup-step__header">
        <p className="setup-step__eyebrow">Your orders</p>
        <h1 className="setup-step__title">Get ready to raise a purchase order</h1>
        <p className="setup-step__lead">
          Add your first supplier below. Your company, branding and defaults are
          already in place.
        </p>
      </header>

      <form
        id={SETUP_FORM_IDS.firstOrder}
        className="setup-form setup-first-order"
        onSubmit={handleSubmit}
        noValidate
      >
        <section className="setup-form__card setup-first-order__section setup-first-order__section--primary">
          <h2 className="setup-first-order__section-title">Your first supplier</h2>
          <p className="setup-first-order__section-lead">
            You&apos;ll need at least one supplier on every order. Add your
            most-used trade now — full details can wait.
          </p>

          <Field
            id={`${formId}-supplierName`}
            label="Supplier name"
            error={showError("supplierName")}
          >
            <input
              id={`${formId}-supplierName`}
              className="setup-input setup-input--primary-focus"
              type="text"
              value={value.supplierName}
              onChange={set("supplierName")}
              placeholder="e.g. Example Groundworks Ltd"
              autoComplete="organization"
              autoFocus
            />
          </Field>

          <div className="setup-form__row">
            <Field
              id={`${formId}-supplierEmail`}
              label="Contact email"
              optional
              error={showError("supplierEmail")}
            >
              <input
                id={`${formId}-supplierEmail`}
                className="setup-input"
                type="email"
                value={value.supplierEmail}
                onChange={set("supplierEmail")}
                placeholder="orders@supplier.co.uk"
                autoComplete="email"
              />
            </Field>

            <Field
              id={`${formId}-supplierPhone`}
              label="Phone"
              optional
            >
              <input
                id={`${formId}-supplierPhone`}
                className="setup-input"
                type="tel"
                value={value.supplierPhone}
                onChange={set("supplierPhone")}
                placeholder="01234 567890"
                autoComplete="tel"
              />
            </Field>
          </div>
        </section>

        <p className="setup-first-order__reassurance">
          <span className="setup-first-order__reassurance-mark" aria-hidden="true">
            ✓
          </span>
          {costCodeCount} cost codes ready — no action needed
        </p>

        <details className="setup-first-order__details">
          <summary className="setup-first-order__details-summary">
            Add another cost code (optional)
          </summary>
          <div className="setup-first-order__details-body">
            <div className="setup-form__row">
              <Field
                id={`${formId}-pendingCostCode`}
                label="Code"
                error={showError("pendingCostCode")}
              >
                <input
                  id={`${formId}-pendingCostCode`}
                  className="setup-input"
                  type="text"
                  value={value.pendingCostCode || ""}
                  onChange={set("pendingCostCode")}
                  placeholder="e.g. E002"
                  autoComplete="off"
                />
              </Field>

              <Field
                id={`${formId}-pendingCostDescription`}
                label="Description"
                error={showError("pendingCostDescription")}
              >
                <input
                  id={`${formId}-pendingCostDescription`}
                  className="setup-input"
                  type="text"
                  value={value.pendingCostDescription || ""}
                  onChange={set("pendingCostDescription")}
                  placeholder="e.g. External doors"
                  autoComplete="off"
                />
              </Field>
            </div>

            <button
              type="button"
              className="setup-btn setup-btn--secondary setup-first-order__add-btn"
              onClick={handleAddCostCode}
            >
              Add to your list
            </button>
          </div>
        </details>

        <details className="setup-first-order__details">
          <summary className="setup-first-order__details-summary">
            Link orders to a job (optional)
          </summary>
          <div className="setup-first-order__details-body">
            <Field id={`${formId}-jobName`} label="Job name" optional>
              <input
                id={`${formId}-jobName`}
                className="setup-input"
                type="text"
                value={value.jobName}
                onChange={set("jobName")}
                placeholder="e.g. Brookfield Phase 2"
                autoComplete="off"
              />
            </Field>

            <div className="setup-form__row">
              <Field id={`${formId}-jobCode`} label="Job code" optional>
                <input
                  id={`${formId}-jobCode`}
                  className="setup-input"
                  type="text"
                  value={value.jobCode}
                  onChange={set("jobCode")}
                  placeholder="e.g. BF-02"
                  autoComplete="off"
                />
              </Field>

              <Field id={`${formId}-jobAddress`} label="Site address" optional>
                <input
                  id={`${formId}-jobAddress`}
                  className="setup-input"
                  type="text"
                  value={value.jobAddress}
                  onChange={set("jobAddress")}
                  placeholder="Optional"
                  autoComplete="street-address"
                />
              </Field>
            </div>
          </div>
        </details>

        <SetupReadinessChecklist firstOrder={value} />
      </form>
    </div>
  );
}
