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

export function loadSetupDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) {
      return {
        step: 1,
        business: { ...EMPTY_BUSINESS },
        identity: { ...EMPTY_IDENTITY },
      };
    }
    const parsed = JSON.parse(raw);
    return {
      step: Number(parsed.step) || 1,
      business: { ...EMPTY_BUSINESS, ...(parsed.business || {}) },
      identity: { ...EMPTY_IDENTITY, ...(parsed.identity || {}) },
    };
  } catch {
    return {
      step: 1,
      business: { ...EMPTY_BUSINESS },
      identity: { ...EMPTY_IDENTITY },
    };
  }
}

export function saveSetupDraft(step, business, identity) {
  try {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step,
        business,
        identity,
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
