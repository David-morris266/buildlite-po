const DRAFT_KEY = "buildlite_setup_draft";

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

export function loadSetupDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return { step: 1, business: { ...EMPTY_BUSINESS } };
    const parsed = JSON.parse(raw);
    return {
      step: Number(parsed.step) || 1,
      business: { ...EMPTY_BUSINESS, ...(parsed.business || {}) },
    };
  } catch {
    return { step: 1, business: { ...EMPTY_BUSINESS } };
  }
}

export function saveSetupDraft(step, business) {
  try {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step, business, updatedAt: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

export function resolveTradingName(companyName, tradingName) {
  const company = String(companyName || "").trim();
  const trading = String(tradingName || "").trim();
  return trading || company;
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
