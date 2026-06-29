import { useState } from "react";
import {
  formatBusinessContact,
  formatPoPrefixPreview,
} from "../setupDraft";

const COMPLETION_ITEMS = [
  "Company",
  "Branding",
  "Company defaults",
  "Supplier",
  "Cost codes",
  "Approval",
];

function LaunchPoPreview({ business, identity, firstOrder, defaults }) {
  const contact = formatBusinessContact(business);
  const accent = identity.accentColor || "#7CFF6B";
  const poNumber = formatPoPrefixPreview(defaults).split(",")[0].trim();
  const supplier = String(firstOrder.supplierName || "").trim() || "Your supplier";
  const job = String(firstOrder.jobName || "").trim();

  return (
    <div
      className="setup-launch-preview"
      style={{ "--setup-preview-accent": accent }}
      aria-hidden="true"
    >
      <p className="setup-launch-preview__label">What you&apos;re about to create</p>
      <div className="setup-launch-preview__paper">
        <div className="setup-launch-preview__banner">
          <div className="setup-launch-preview__brand">
            <p className="setup-launch-preview__company">{contact.name}</p>
            <p className="setup-launch-preview__doc">Purchase Order {poNumber}</p>
          </div>
        </div>
        <div className="setup-launch-preview__facts">
          <p>
            <b>Supplier:</b> {supplier}
          </p>
          {job ? (
            <p>
              <b>Project:</b> {job}
            </p>
          ) : null}
          <p>
            <b>Line items:</b> Your order details
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SetupReady({
  business,
  identity,
  defaults,
  firstOrder,
  onLaunchPO,
  onExplore,
  onFinishLater,
}) {
  const [launching, setLaunching] = useState(false);

  const handleLaunch = () => {
    if (launching) return;
    setLaunching(true);
    window.setTimeout(() => onLaunchPO?.(), 680);
  };

  return (
    <>
      {launching ? (
        <div className="setup-launch-transition" aria-hidden="true">
          <div className="setup-launch-transition__pulse" />
        </div>
      ) : null}

      <div
        className={`setup-ready setup-step setup-animate-in${
          launching ? " setup-ready--launching" : ""
        }`}
      >
        <div className="setup-ready__hero">
          <div className="setup-ready__success" aria-hidden="true">
            <svg viewBox="0 0 48 48" className="setup-ready__success-icon">
              <circle cx="24" cy="24" r="22" className="setup-ready__success-ring" />
              <path
                d="M15 24.5l6.5 6.5L33 18.5"
                className="setup-ready__success-check"
                fill="none"
              />
            </svg>
          </div>

          <header className="setup-step__header setup-ready__header">
            <p className="setup-step__eyebrow">Ready to go</p>
            <h1 className="setup-step__title setup-ready__title">
              You&apos;re ready to create your first Purchase Order
            </h1>
            <p className="setup-step__lead setup-ready__lead">
              Everything you need is now in place. Let&apos;s create your first
              Purchase Order together.
            </p>
          </header>
        </div>

        <div className="setup-ready__body">
          <div className="setup-ready__checklist">
            <p className="setup-ready__checklist-label">All completed</p>
            <ul className="setup-ready__checklist-list">
              {COMPLETION_ITEMS.map((item) => (
                <li key={item} className="setup-ready__checklist-item">
                  <span className="setup-ready__checklist-mark" aria-hidden="true">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <LaunchPoPreview
            business={business}
            identity={identity}
            firstOrder={firstOrder}
            defaults={defaults}
          />
        </div>

        <div className="setup-ready__actions">
          <button
            type="button"
            className="setup-btn setup-btn--primary setup-btn--launch"
            onClick={handleLaunch}
            disabled={launching}
          >
            Create my first Purchase Order
          </button>

          <div className="setup-ready__secondary">
            <button
              type="button"
              className="setup-btn setup-btn--link"
              onClick={onExplore}
              disabled={launching}
            >
              Explore BuildLite
            </button>
            <button
              type="button"
              className="setup-btn setup-btn--link"
              onClick={onFinishLater}
              disabled={launching}
            >
              Finish later
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
