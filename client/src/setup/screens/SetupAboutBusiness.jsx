import { useEffect, useId, useState } from "react";
import { SETUP_FORM_IDS } from "../constants";

function Field({
  id,
  label,
  optional,
  hint,
  error,
  softError,
  children,
}) {
  const errorId = error || softError ? `${id}-error` : undefined;

  return (
    <div
      className={`setup-field${error ? " setup-field--error" : ""}${
        softError ? " setup-field--soft" : ""
      }`}
    >
      <label className="setup-field__label" htmlFor={id}>
        {label}
        {optional ? (
          <span className="setup-field__optional">Optional</span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p className="setup-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="setup-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
      {!error && softError ? (
        <p className="setup-field__soft" id={errorId}>
          {softError}
        </p>
      ) : null}
    </div>
  );
}

export default function SetupAboutBusiness({
  value,
  onChange,
  errors = {},
  onSubmit,
}) {
  const formId = useId();
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (Object.keys(errors).length) setTouched(true);
  }, [errors]);

  const set = (field) => (e) => {
    onChange({ ...value, [field]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setTouched(true);
    onSubmit?.();
  };

  const showError = (field) => (touched ? errors[field] : undefined);
  const postcodeMsg = showError("postcode");
  const postcodeSoft =
    postcodeMsg && postcodeMsg.includes("Check this postcode")
      ? postcodeMsg
      : undefined;
  const postcodeHard =
    postcodeMsg && !postcodeSoft ? postcodeMsg : undefined;

  return (
    <div className="setup-step setup-animate-in">
      <header className="setup-step__header">
        <p className="setup-step__eyebrow">Your company</p>
        <h1 className="setup-step__title">Tell us about your business</h1>
        <p className="setup-step__lead">
          These details appear on your purchase orders and payment certificates.
          You can update them any time in Company Settings.
        </p>
      </header>

      <form
        id={SETUP_FORM_IDS.business}
        className="setup-form setup-form__card"
        onSubmit={handleSubmit}
        noValidate
      >
        <fieldset className="setup-form__group">
          <legend className="setup-form__legend">Company names</legend>

          <Field
            id={`${formId}-companyName`}
            label="Registered company name"
            error={showError("companyName")}
          >
            <input
              id={`${formId}-companyName`}
              className="setup-input"
              type="text"
              autoComplete="organization"
              value={value.companyName}
              onChange={set("companyName")}
              placeholder="e.g. Levison Rose Homes Ltd"
            />
          </Field>

          <Field
            id={`${formId}-tradingName`}
            label="Trading name"
            optional
            hint="Leave blank if the same as your registered company name."
          >
            <input
              id={`${formId}-tradingName`}
              className="setup-input"
              type="text"
              autoComplete="organization-title"
              value={value.tradingName}
              onChange={set("tradingName")}
              placeholder="Same as registered company name"
            />
          </Field>
        </fieldset>

        <fieldset className="setup-form__group">
          <legend className="setup-form__legend">Registered address</legend>

          <Field
            id={`${formId}-addressLine1`}
            label="Address line 1"
            error={showError("addressLine1")}
          >
            <input
              id={`${formId}-addressLine1`}
              className="setup-input"
              type="text"
              autoComplete="address-line1"
              value={value.addressLine1}
              onChange={set("addressLine1")}
              placeholder="Street or building name"
            />
          </Field>

          <Field
            id={`${formId}-addressLine2`}
            label="Address line 2"
            optional
          >
            <input
              id={`${formId}-addressLine2`}
              className="setup-input"
              type="text"
              autoComplete="address-line2"
              value={value.addressLine2}
              onChange={set("addressLine2")}
              placeholder="Suite, unit, etc."
            />
          </Field>

          <div className="setup-form__row">
            <Field
              id={`${formId}-town`}
              label="Town / city"
              error={showError("town")}
            >
              <input
                id={`${formId}-town`}
                className="setup-input"
                type="text"
                autoComplete="address-level2"
                value={value.town}
                onChange={set("town")}
              />
            </Field>

            <Field
              id={`${formId}-postcode`}
              label="Postcode"
              error={postcodeHard}
              softError={postcodeSoft}
            >
              <input
                id={`${formId}-postcode`}
                className="setup-input setup-input--lookup-ready"
                type="text"
                autoComplete="postal-code"
                inputMode="text"
                value={value.postcode}
                onChange={set("postcode")}
                placeholder="e.g. WR11 7QB"
                data-lookup="postcode"
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="setup-form__group setup-form__group--last">
          <legend className="setup-form__legend">Registration</legend>

          <div className="setup-form__row">
            <Field
              id={`${formId}-vatNumber`}
              label="VAT number"
              optional
              hint="Leave blank if not VAT registered."
            >
              <input
                id={`${formId}-vatNumber`}
                className="setup-input"
                type="text"
                autoComplete="off"
                value={value.vatNumber}
                onChange={set("vatNumber")}
                placeholder="e.g. GB 123 4567 89"
              />
            </Field>

            <Field
              id={`${formId}-companyNumber`}
              label="Company registration number"
              optional
              hint="As registered with Companies House, if applicable."
            >
              <input
                id={`${formId}-companyNumber`}
                className="setup-input setup-input--lookup-ready"
                type="text"
                autoComplete="off"
                value={value.companyNumber}
                onChange={set("companyNumber")}
                placeholder="e.g. 12345678"
                data-lookup="companies-house"
              />
            </Field>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
