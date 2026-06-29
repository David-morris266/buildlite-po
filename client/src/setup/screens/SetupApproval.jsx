import { useEffect, useId, useState } from "react";
import { SETUP_FORM_IDS } from "../constants";
import SetupReadinessChecklist from "../components/SetupReadinessChecklist";

function Field({ id, label, error, children }) {
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

export default function SetupApproval({
  value,
  firstOrder,
  onChange,
  errors = {},
  onSubmit,
}) {
  const formId = useId();
  const [touched, setTouched] = useState(false);
  const isSelf = value.mode !== "other";

  useEffect(() => {
    if (Object.keys(errors).length) setTouched(true);
  }, [errors]);

  const showError = (field) => (touched ? errors[field] : undefined);

  const setMode = (mode) => {
    onChange({
      ...value,
      mode,
      ...(mode === "self"
        ? { approverName: "", approverEmail: "" }
        : {}),
    });
  };

  const set = (field) => (event) => {
    onChange({ ...value, [field]: event.target.value });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setTouched(true);
    onSubmit?.();
  };

  return (
    <div className="setup-step setup-step--approval setup-animate-in">
      <header className="setup-step__header">
        <p className="setup-step__eyebrow">Your team</p>
        <h1 className="setup-step__title">Who approves Purchase Orders?</h1>
        <p className="setup-step__lead">
          Every company approves purchase orders differently. Tell us who
          normally gives approval.
        </p>
      </header>

      <form
        id={SETUP_FORM_IDS.approval}
        className="setup-approval"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="setup-approval__layout">
          <div className="setup-approval__main">
            <div
              className="setup-form__card setup-approval__choices"
              role="radiogroup"
              aria-label="Who approves purchase orders?"
            >
              <label
                className={`setup-approval__choice${
                  isSelf ? " setup-approval__choice--selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name={`${formId}-mode`}
                  value="self"
                  checked={isSelf}
                  onChange={() => setMode("self")}
                  className="setup-approval__radio"
                />
                <span className="setup-approval__choice-mark" aria-hidden="true">
                  {isSelf ? "☑" : "○"}
                </span>
                <span className="setup-approval__choice-text">
                  I approve Purchase Orders myself
                </span>
              </label>

              {isSelf ? (
                <p className="setup-approval__reassurance">
                  Perfect. Orders will come straight to you for approval.
                </p>
              ) : null}

              <label
                className={`setup-approval__choice${
                  !isSelf ? " setup-approval__choice--selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name={`${formId}-mode`}
                  value="other"
                  checked={!isSelf}
                  onChange={() => setMode("other")}
                  className="setup-approval__radio"
                />
                <span className="setup-approval__choice-mark" aria-hidden="true">
                  {!isSelf ? "☑" : "○"}
                </span>
                <span className="setup-approval__choice-text">
                  Someone else approves orders
                </span>
              </label>

              {!isSelf ? (
                <div className="setup-approval__other-fields">
                  <Field
                    id={`${formId}-approverName`}
                    label="Approver name"
                    error={showError("approverName")}
                  >
                    <input
                      id={`${formId}-approverName`}
                      className="setup-input setup-input--primary-focus"
                      type="text"
                      value={value.approverName}
                      onChange={set("approverName")}
                      placeholder="e.g. Sarah Mitchell"
                      autoComplete="name"
                      autoFocus
                    />
                  </Field>

                  <Field
                    id={`${formId}-approverEmail`}
                    label="Approver email"
                    error={showError("approverEmail")}
                  >
                    <input
                      id={`${formId}-approverEmail`}
                      className="setup-input"
                      type="email"
                      value={value.approverEmail}
                      onChange={set("approverEmail")}
                      placeholder="e.g. sarah@company.co.uk"
                      autoComplete="email"
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          </div>

          <aside className="setup-approval__aside">
            <SetupReadinessChecklist
              firstOrder={firstOrder}
              approval={value}
              className="setup-checklist--panel"
            />
          </aside>
        </div>
      </form>
    </div>
  );
}
