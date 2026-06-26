import { useCallback, useId, useRef, useState } from "react";
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  formatBusinessContact,
} from "../setupDraft";

function initialsFromName(name) {
  return String(name || "BL")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function LogoPlaceholder({ name }) {
  return (
    <div className="setup-logo-placeholder" aria-hidden="true">
      <span className="setup-logo-placeholder__mark">{initialsFromName(name)}</span>
      <span className="setup-logo-placeholder__label">Your logo</span>
    </div>
  );
}

function PoHeaderPreview({ identity, contact }) {
  const accent = identity.accentColor || DEFAULT_ACCENT;
  const hasLogo = Boolean(identity.logoPreviewUrl);

  return (
    <div
      className="setup-po-preview"
      style={{ "--setup-preview-accent": accent }}
    >
      <p className="setup-po-preview__label">Purchase Order preview</p>
      <div className="setup-po-preview__paper">
        <div className="setup-po-preview__banner">
          {hasLogo ? (
            <img
              className="setup-po-preview__logo"
              src={identity.logoPreviewUrl}
              alt=""
            />
          ) : (
            <LogoPlaceholder name={contact.name} />
          )}
          <div className="setup-po-preview__brand">
            <p className="setup-po-preview__company">{contact.name}</p>
            {contact.addressLines.map((line) => (
              <p key={line} className="setup-po-preview__line">
                {line}
              </p>
            ))}
            {contact.vatNumber ? (
              <p className="setup-po-preview__line">VAT: {contact.vatNumber}</p>
            ) : null}
          </div>
        </div>

        <div className="setup-po-preview__title-row">
          <span className="setup-po-preview__doc-title">Purchase Order PO-0001</span>
          <span className="setup-po-preview__meta">25 Jun 2026</span>
        </div>

        <div className="setup-po-preview__body">
          <div className="setup-po-preview__facts">
            <p className="setup-po-preview__fact">
              <b>Supplier:</b> Example Groundworks Ltd
            </p>
            <p className="setup-po-preview__fact">
              <b>Project:</b> Brookfield Phase 2
            </p>
          </div>

          <table className="setup-po-preview__table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th className="setup-po-preview__right">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Excavation and disposal</td>
                <td>1</td>
                <td className="setup-po-preview__right">£4,250.00</td>
              </tr>
              <tr>
                <td>Hardcore supply</td>
                <td>12</td>
                <td className="setup-po-preview__right">£1,680.00</td>
              </tr>
            </tbody>
          </table>

          <div className="setup-po-preview__total-row">
            <span>Total (ex VAT)</span>
            <span className="setup-po-preview__total">£5,930.00</span>
          </div>
        </div>
      </div>

      <p className="setup-po-preview__reassurance">
        Your logo and accent colour will appear on Purchase Orders, Payment
        Certificates and reports.
      </p>
    </div>
  );
}

export default function SetupCompanyIdentity({
  identity,
  business,
  onChange,
  onSubmit,
}) {
  const inputId = useId();
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileHint, setFileHint] = useState("");

  const contact = formatBusinessContact(business);
  const accentColor = identity.accentColor || DEFAULT_ACCENT;

  const applyLogoFile = useCallback(
    (file) => {
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        setFileHint("Please choose an image file (PNG, JPG or SVG).");
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        setFileHint("For now, choose an image under 2 MB.");
        return;
      }

      setFileHint("");
      const reader = new FileReader();
      reader.onload = (event) => {
        onChange({
          ...identity,
          logoFileName: file.name,
          logoPreviewUrl: String(event.target?.result || ""),
        });
      };
      reader.readAsDataURL(file);
    },
    [identity, onChange]
  );

  const handleFileInput = (event) => {
    applyLogoFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    applyLogoFile(event.dataTransfer.files?.[0]);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => setDragActive(false);

  const handleRemoveLogo = () => {
    setFileHint("");
    onChange({
      ...identity,
      logoFileName: "",
      logoPreviewUrl: "",
    });
  };

  const handleAccentChange = (value) => {
    onChange({ ...identity, accentColor: value });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.();
  };

  const presetValues = ACCENT_PRESETS.map((preset) => preset.value.toLowerCase());
  const isCustomAccent = !presetValues.includes(accentColor.toLowerCase());

  return (
    <div className="setup-step setup-step--identity setup-animate-in">
      <header className="setup-step__header">
        <p className="setup-step__eyebrow">Your company identity</p>
        <h1 className="setup-step__title">Make BuildLite yours</h1>
        <p className="setup-step__lead">
          Add your logo and choose an accent colour so every purchase order,
          certificate and report feels unmistakably yours.
        </p>
      </header>

      <div className="setup-why">
        <p className="setup-why__label">Why we ask</p>
        <p className="setup-why__text">
          These details appear on your Purchase Orders, Payment Certificates
          and reports. You can change them any time in Company Settings.
        </p>
      </div>

      <form className="setup-identity" onSubmit={handleSubmit} noValidate>
        <div className="setup-identity__layout">
          <div className="setup-identity__controls">
            <section className="setup-identity__card setup-identity__card--logo">
              <h2 className="setup-identity__section-title">Company logo</h2>
              <p className="setup-identity__section-lead">
                Optional — PNG or JPG works best.
              </p>

              <div
                className={`setup-dropzone${
                  dragActive ? " setup-dropzone--active" : ""
                }${identity.logoPreviewUrl ? " setup-dropzone--has-logo" : ""}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                data-upload-ready="logo"
              >
                {identity.logoPreviewUrl ? (
                  <div className="setup-dropzone__preview">
                    <img
                      src={identity.logoPreviewUrl}
                      alt="Logo preview"
                      className="setup-dropzone__image"
                    />
                  </div>
                ) : (
                  <LogoPlaceholder name={contact.name} />
                )}

                <div className="setup-dropzone__copy">
                  <p className="setup-dropzone__hint">
                    Drag and drop, or choose a file
                  </p>
                  <div className="setup-dropzone__actions">
                    <button
                      type="button"
                      className="setup-btn setup-btn--secondary setup-dropzone__upload"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose logo
                    </button>
                    {identity.logoPreviewUrl ? (
                      <button
                        type="button"
                        className="setup-btn setup-btn--link setup-dropzone__remove"
                        onClick={handleRemoveLogo}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  id={`${inputId}-logo`}
                  className="setup-dropzone__input"
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleFileInput}
                  tabIndex={-1}
                  aria-hidden="true"
                />
              </div>

              {fileHint ? (
                <p className="setup-identity__hint setup-identity__hint--soft">
                  {fileHint}
                </p>
              ) : (
                <p className="setup-identity__hint">
                  Stored locally for now — upload to BuildLite will arrive in a
                  later update.
                </p>
              )}
            </section>

            <section className="setup-identity__card">
              <h2 className="setup-identity__section-title">Accent colour</h2>
              <p className="setup-identity__section-lead">
                Used for headings, buttons and highlights across your documents.
              </p>

              <div
                className="setup-accent-swatches"
                role="radiogroup"
                aria-label="Accent colour"
              >
                {ACCENT_PRESETS.map((preset) => {
                  const selected =
                    accentColor.toLowerCase() === preset.value.toLowerCase();
                  return (
                    <label
                      key={preset.id}
                      className={`setup-accent-swatches__option${
                        selected ? " setup-accent-swatches__option--selected" : ""
                      }`}
                      title={preset.label}
                      style={{ "--swatch-ring": preset.value }}
                    >
                      <input
                        type="radio"
                        name={`${inputId}-accent`}
                        value={preset.value}
                        checked={selected}
                        onChange={() => handleAccentChange(preset.value)}
                        className="setup-accent-swatches__input"
                        aria-label={preset.label}
                      />
                      <span
                        className="setup-accent-swatches__swatch"
                        style={{ backgroundColor: preset.value }}
                      />
                    </label>
                  );
                })}

                <label
                  className={`setup-accent-swatches__option setup-accent-swatches__option--custom${
                    isCustomAccent ? " setup-accent-swatches__option--selected" : ""
                  }`}
                  title="Custom colour"
                  style={{ "--swatch-ring": accentColor }}
                >
                  <input
                    id={`${inputId}-custom-accent`}
                    className="setup-accent-swatches__color"
                    type="color"
                    value={accentColor}
                    onChange={(event) => handleAccentChange(event.target.value)}
                    aria-label="Custom colour"
                  />
                  <span
                    className="setup-accent-swatches__swatch setup-accent-swatches__swatch--custom"
                    style={{ backgroundColor: accentColor }}
                  />
                </label>
              </div>
            </section>
          </div>

          <aside className="setup-identity__preview">
            <PoHeaderPreview identity={identity} contact={contact} />
          </aside>
        </div>
      </form>
    </div>
  );
}
