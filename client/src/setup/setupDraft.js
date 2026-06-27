const DRAFT_KEY = "buildlite_setup_draft";

export const DEFAULT_ACCENT = "#7CFF6B";

export const ACCENT_PRESETS = [
  { id: "buildlite", label: "BuildLite green", value: "#7CFF6B" },
  { id: "ocean", label: "Ocean blue", value: "#4DA3FF" },
  { id: "forest", label: "Forest", value: "#29D659" },
  { id: "amber", label: "Warm amber", value: "#F5A623" },
  { id: "slate", label: "Slate", value: "#8B9DC3" },
];

export const EMPTY_BUSINESS = {
  companyName: "",
  tradingName: "",
  addressLine1: "",
  addressLine2: "",
  town: "",
  postcode: "",
  vatNumber: "",
  companyNumber: "",
};

export const EMPTY_IDENTITY = {
  accentColor: DEFAULT_ACCENT,
  logoFileName: "",
  logoPreviewUrl: "",
};

export const EMPTY_DEFAULTS = {
  vatRate: 0.2,
  retentionRate: 0.05,
  paymentTerms: "30",
  poNumberPrefix: "type",
  poNumberPrefixCustom: "",
  currency: "GBP",
};

export const VAT_RATE_OPTIONS = [
  { value: 0.2, label: "20% — Standard rate", why: "Pre-fills tax on new purchase orders." },
  { value: 0.05, label: "5% — Reduced rate", why: "For qualifying goods and services." },
  { value: 0, label: "0% — Zero-rated", why: "When no VAT applies to your orders." },
];

export const RETENTION_OPTIONS = [
  { value: 0, label: "None", why: "No retention held by default." },
  { value: 0.025, label: "2.5%", why: "Light retention on certificates." },
  { value: 0.05, label: "5%", why: "Common on construction contracts." },
  { value: 0.075, label: "7.5%", why: "Mid-range retention." },
  { value: 0.1, label: "10%", why: "Higher retention on certificates." },
];

export const PAYMENT_TERMS_OPTIONS = [
  { value: "on_receipt", label: "Due on receipt", why: "Printed on orders to suppliers." },
  { value: "7", label: "7 days", why: "Short payment window." },
  { value: "14", label: "14 days", why: "Fortnightly payment cycle." },
  { value: "30", label: "30 days", why: "Most common for trade accounts." },
  { value: "45", label: "45 days", why: "Extended terms." },
  { value: "60", label: "60 days", why: "Longer payment period." },
];

export const CURRENCY_OPTIONS = [
  { value: "GBP", label: "GBP — British pound", why: "Used on POs and certificates today." },
  { value: "EUR", label: "EUR — Euro", why: "Ready if you trade overseas later." },
  { value: "USD", label: "USD — US dollar", why: "Ready for international suppliers." },
];

export const PO_PREFIX_OPTIONS = [
  {
    value: "type",
    label: "By order type (M0001, S0001…)",
    why: "Matches how BuildLite numbers orders today.",
  },
  {
    value: "PO-",
    label: "PO-0001",
    why: "A single prefix for every order type.",
  },
  { value: "custom", label: "Custom prefix…", why: "Your own letters before the number." },
];

export function loadSetupDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) {
      return {
        step: 1,
        business: { ...EMPTY_BUSINESS },
        identity: { ...EMPTY_IDENTITY },
        defaults: { ...EMPTY_DEFAULTS },
      };
    }
    const parsed = JSON.parse(raw);
    return {
      step: Number(parsed.step) || 1,
      business: { ...EMPTY_BUSINESS, ...(parsed.business || {}) },
      identity: { ...EMPTY_IDENTITY, ...(parsed.identity || {}) },
      defaults: { ...EMPTY_DEFAULTS, ...(parsed.defaults || {}) },
    };
  } catch {
    return {
      step: 1,
      business: { ...EMPTY_BUSINESS },
      identity: { ...EMPTY_IDENTITY },
      defaults: { ...EMPTY_DEFAULTS },
    };
  }
}

export function saveSetupDraft(step, business, identity, defaults) {
  try {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step,
        business,
        identity,
        defaults,
        updatedAt: Date.now(),
      })
    );
  } catch {
    /* ignore — e.g. sessionStorage quota with large logo data URLs */
  }
}

export function resolveTradingName(companyName, tradingName) {
  const company = String(companyName || "").trim();
  const trading = String(tradingName || "").trim();
  return trading || company;
}

export function formatBusinessContact(business) {
  const name = resolveTradingName(business.companyName, business.tradingName);
  const addressLines = [
    business.addressLine1,
    business.addressLine2,
    [business.town, business.postcode].filter(Boolean).join(", "),
  ].filter((line) => String(line || "").trim());

  return {
    name: name || "Your company name",
    addressLines,
    vatNumber: String(business.vatNumber || "").trim(),
  };
}

export function validateBusiness(business) {
  const errors = {};
  const companyName = String(business.companyName || "").trim();
  const addressLine1 = String(business.addressLine1 || "").trim();
  const town = String(business.town || "").trim();
  const postcode = String(business.postcode || "").trim();

  if (!companyName) {
    errors.companyName = "Please enter your registered company name.";
  }
  if (!addressLine1) {
    errors.addressLine1 = "We need your address for purchase orders.";
  }
  if (!town) {
    errors.town = "Please enter the town or city.";
  }
  if (!postcode) {
    errors.postcode = "Please enter your postcode.";
  } else if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(postcode)) {
    errors.postcode = "Check this postcode looks right — you can still continue.";
  }

  return errors;
}

/** Postcode format warnings are soft — they do not block Continue. */
export function canContinue(errors) {
  const blocking = { ...errors };
  if (
    blocking.postcode &&
    String(blocking.postcode).includes("Check this postcode")
  ) {
    delete blocking.postcode;
  }
  return Object.keys(blocking).length === 0;
}

export function formatPaymentTermsLabel(value) {
  const match = PAYMENT_TERMS_OPTIONS.find((option) => option.value === value);
  return match?.label || "30 days";
}

export function formatPoPrefixPreview(defaults) {
  if (defaults.poNumberPrefix === "type") return "M0001, S0001, P0001";
  if (defaults.poNumberPrefix === "PO-") return "PO-0001";
  const custom = String(defaults.poNumberPrefixCustom || "").trim();
  if (defaults.poNumberPrefix === "custom" && custom) return `${custom}0001`;
  if (defaults.poNumberPrefix === "custom") return "Your prefix + 0001";
  return "PO-0001";
}

export function formatDefaultsSummary(defaults) {
  const vat = VAT_RATE_OPTIONS.find((o) => o.value === Number(defaults.vatRate));
  const retention = RETENTION_OPTIONS.find(
    (o) => o.value === Number(defaults.retentionRate)
  );
  const currency = CURRENCY_OPTIONS.find((o) => o.value === defaults.currency);

  return {
    vat: vat ? vat.label.split(" — ")[0] : "20%",
    retention: retention?.label || "5%",
    paymentTerms: formatPaymentTermsLabel(defaults.paymentTerms),
    currency: currency?.value || "GBP",
    poNumbers: formatPoPrefixPreview(defaults),
  };
}

export function validateDefaults(defaults) {
  const errors = {};
  if (defaults.poNumberPrefix === "custom") {
    const custom = String(defaults.poNumberPrefixCustom || "").trim();
    if (!custom) {
      errors.poNumberPrefixCustom = "Enter a short prefix, or choose another option.";
    } else if (!/^[A-Za-z0-9-]{1,8}$/.test(custom)) {
      errors.poNumberPrefixCustom =
        "Use up to 8 letters, numbers or hyphens.";
    }
  }
  return errors;
}
