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

/** Starter cost codes — mirrors typical seeded housebuilding list (client-only for setup). */
export const STARTER_COST_CODES = [
  { code: "M001", description: "Foundations & groundworks" },
  { code: "S001", description: "Structural frame" },
  { code: "R001", description: "Roofing" },
  { code: "E001", description: "Electrical" },
  { code: "P001", description: "Plumbing & heating" },
  { code: "F001", description: "Finishes" },
  { code: "L001", description: "Landscaping" },
  { code: "G001", description: "Preliminaries & general" },
];

export const EMPTY_FIRST_ORDER = {
  starterCostCodes: STARTER_COST_CODES.map((item) => ({ ...item })),
  customCostCodes: [],
  pendingCostCode: "",
  pendingCostDescription: "",
  supplierName: "",
  supplierEmail: "",
  supplierPhone: "",
  supplierId: "",
  jobName: "",
  jobCode: "",
  jobAddress: "",
  jobId: "",
};

export const EMPTY_APPROVAL = {
  mode: "self",
  approverName: "",
  approverEmail: "",
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
  { value: "GBP", label: "GBP — British pound", why: "Used on purchase orders and certificates." },
  { value: "EUR", label: "EUR — Euro", why: "For suppliers billed in euros." },
  { value: "USD", label: "USD — US dollar", why: "For suppliers billed in dollars." },
];

export const PO_PREFIX_OPTIONS = [
  {
    value: "type",
    label: "By order type (M0001, S0001…)",
    why: "Uses your order type as the prefix.",
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
        firstOrder: { ...EMPTY_FIRST_ORDER },
        approval: { ...EMPTY_APPROVAL },
      };
    }
    const parsed = JSON.parse(raw);
    const firstOrder = { ...EMPTY_FIRST_ORDER, ...(parsed.firstOrder || {}) };
    if (!parsed.firstOrder?.starterCostCodes?.length) {
      firstOrder.starterCostCodes = STARTER_COST_CODES.map((item) => ({ ...item }));
    }
    return {
      step: Number(parsed.step) || 1,
      business: { ...EMPTY_BUSINESS, ...(parsed.business || {}) },
      identity: { ...EMPTY_IDENTITY, ...(parsed.identity || {}) },
      defaults: { ...EMPTY_DEFAULTS, ...(parsed.defaults || {}) },
      firstOrder,
      approval: { ...EMPTY_APPROVAL, ...(parsed.approval || {}) },
    };
  } catch {
    return {
      step: 1,
      business: { ...EMPTY_BUSINESS },
      identity: { ...EMPTY_IDENTITY },
      defaults: { ...EMPTY_DEFAULTS },
      firstOrder: { ...EMPTY_FIRST_ORDER },
      approval: { ...EMPTY_APPROVAL },
    };
  }
}

export function saveSetupDraft(
  step,
  business,
  identity,
  defaults,
  firstOrder,
  approval
) {
  try {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step,
        business,
        identity,
        defaults,
        firstOrder,
        approval,
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

export function mergeCostCodes(starterCostCodes = [], customCostCodes = []) {
  const merged = [];
  const seen = new Set();

  for (const item of [...starterCostCodes, ...customCostCodes]) {
    const code = String(item?.code || "").trim();
    if (!code || seen.has(code.toLowerCase())) continue;
    seen.add(code.toLowerCase());
    merged.push({
      code,
      description: String(item?.description || "").trim(),
    });
  }

  return merged;
}

export function countCostCodes(firstOrder) {
  return mergeCostCodes(
    firstOrder?.starterCostCodes,
    firstOrder?.customCostCodes
  ).length;
}

export function formatFirstOrderSummary(firstOrder) {
  const count = countCostCodes(firstOrder);
  const supplier = String(firstOrder?.supplierName || "").trim();
  const job = String(firstOrder?.jobName || "").trim();

  return {
    costCodes: `${count} cost code${count === 1 ? "" : "s"} ready`,
    supplier,
    job,
  };
}

export function validateFirstOrder(firstOrder) {
  const errors = {};
  const supplierName = String(firstOrder?.supplierName || "").trim();
  const pendingCode = String(firstOrder?.pendingCostCode || "").trim();
  const pendingDescription = String(
    firstOrder?.pendingCostDescription || ""
  ).trim();
  const email = String(firstOrder?.supplierEmail || "").trim();

  if (!supplierName) {
    errors.supplierName = "Please enter a supplier name.";
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.supplierEmail = "Check this email address looks right.";
  }

  if (pendingCode && !pendingDescription) {
    errors.pendingCostDescription = "Add a description for this code.";
  }
  if (pendingDescription && !pendingCode) {
    errors.pendingCostCode = "Enter a code, or clear the description.";
  }

  if (countCostCodes(firstOrder) < 1) {
    errors.costCodes = "Add at least one cost code to continue.";
  }

  return errors;
}

/** Flush any valid pending cost code into customCostCodes before continuing. */
export function finalizeFirstOrder(firstOrder) {
  const pendingCode = String(firstOrder?.pendingCostCode || "").trim();
  const pendingDescription = String(
    firstOrder?.pendingCostDescription || ""
  ).trim();

  if (!pendingCode || !pendingDescription) {
    return { ...firstOrder, pendingCostCode: "", pendingCostDescription: "" };
  }

  const exists = mergeCostCodes(
    firstOrder.starterCostCodes,
    firstOrder.customCostCodes
  ).some((item) => item.code.toLowerCase() === pendingCode.toLowerCase());

  if (exists) {
    return { ...firstOrder, pendingCostCode: "", pendingCostDescription: "" };
  }

  return {
    ...firstOrder,
    customCostCodes: [
      ...(firstOrder.customCostCodes || []),
      { code: pendingCode, description: pendingDescription },
    ],
    pendingCostCode: "",
    pendingCostDescription: "",
  };
}

export function isApprovalReady(approval) {
  if (approval?.mode === "other") {
    const name = String(approval.approverName || "").trim();
    const email = String(approval.approverEmail || "").trim();
    if (!name) return false;
    return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  }
  return approval?.mode !== "other";
}

export function validateApproval(approval) {
  const errors = {};

  if (approval?.mode === "other") {
    if (!String(approval.approverName || "").trim()) {
      errors.approverName = "Please enter the approver's name.";
    }
    const email = String(approval.approverEmail || "").trim();
    if (!email) {
      errors.approverEmail = "Please enter the approver's email address.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.approverEmail = "Check this email address looks right.";
    }
  }

  return errors;
}

/**
 * Map setup draft → PO form field values (BL-007A.07 launch continuity).
 * Reads from the existing setup draft only — no duplicate storage.
 */
export function buildPoFormSeedFromSetup(draft) {
  if (!draft) return null;

  const { business, defaults, firstOrder } = draft;
  const supplierName = String(firstOrder?.supplierName || "").trim();
  const jobName = String(firstOrder?.jobName || "").trim();
  const jobCode = String(firstOrder?.jobCode || "").trim();
  const jobAddress = String(firstOrder?.jobAddress || "").trim();

  return {
    companyName: resolveTradingName(
      business?.companyName,
      business?.tradingName
    ),
    supplierName,
    supplierEmail: String(firstOrder?.supplierEmail || "").trim(),
    supplierPhone: String(firstOrder?.supplierPhone || "").trim(),
    supplierId: String(firstOrder?.supplierId || "").trim(),
    job: jobName
      ? {
          id: String(firstOrder?.jobId || "").trim(),
          name: jobName,
          jobCode,
          jobAddress,
        }
      : null,
    jobId: String(firstOrder?.jobId || "").trim(),
    vatRate: Number(defaults?.vatRate ?? 0.2),
    retentionRate: Number(defaults?.retentionRate ?? 0.05),
    paymentTerms: formatPaymentTermsLabel(defaults?.paymentTerms || "30"),
    paymentTermsDays:
      defaults?.paymentTerms === "on_receipt"
        ? 0
        : Number.parseInt(String(defaults?.paymentTerms || "30"), 10) || 30,
    currency:
      CURRENCY_OPTIONS.find((o) => o.value === defaults?.currency)?.label ||
      defaults?.currency ||
      "GBP",
    poNumberPrefix: defaults?.poNumberPrefix || "type",
    poNumberHint: formatPoPrefixPreview(defaults || EMPTY_DEFAULTS),
    orderType: "M",
  };
}

/** Company display name from setup draft (for PO clause copy). */
export function getCompanyDisplayNameFromDraft(draft = null) {
  const d = draft || loadSetupDraft();
  return (
    resolveTradingName(d.business?.companyName, d.business?.tradingName) ||
    ""
  );
}

/** Approver routing from Setup Assistant step 6. */
export function getSetupApprovalRouting(draft = null) {
  const d = draft || loadSetupDraft();
  const approval = d.approval || EMPTY_APPROVAL;
  const userEmail = localStorage.getItem("userEmail") || "";
  const userName = localStorage.getItem("userName") || "";

  if (approval.mode === "other") {
    return {
      mode: "other",
      approverName: String(approval.approverName || "").trim(),
      approverEmail: String(approval.approverEmail || "").trim(),
    };
  }

  return {
    mode: "self",
    approverName: userName || "Approver",
    approverEmail: userEmail,
  };
}

/** Body for POST /api/po/:number/request-approval */
export function buildRequestApprovalBody(note = "") {
  const routing = getSetupApprovalRouting();
  const userEmail = localStorage.getItem("userEmail") || "";
  return {
    by: userEmail,
    note,
    approverMode: routing.mode,
    approverName: routing.approverName,
    approverEmail: routing.approverEmail,
  };
}

/** Body for POST /api/po/:number/approve */
export function buildApproveBody(status, note = "") {
  const routing = getSetupApprovalRouting();
  return {
    status,
    approver: routing.approverName || routing.approverEmail || "",
    approverEmail: routing.approverEmail,
    note,
  };
}

/** Whether a requester can send this PO for approval (List / drawer). */
export function canSendPoForApproval(po) {
  if (!po) return false;
  if (isPoAwaitingApproval(po)) return false;
  const approvalStatusLower = String(po.approval?.status || "").toLowerCase();
  const poStatusLower = String(po.status || "").toLowerCase();
  if (approvalStatusLower === "approved" || poStatusLower === "approved") {
    return false;
  }
  return (
    approvalStatusLower === "draft" ||
    approvalStatusLower === "rejected" ||
    !approvalStatusLower ||
    poStatusLower === "draft" ||
    poStatusLower === "rejected"
  );
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** Resolve approver email from PO payload or setup routing. */
export function getPoApproverEmail(po) {
  const fromPo = String(po?.approval?.approverEmail || "").trim();
  if (fromPo) return fromPo;
  return getSetupApprovalRouting().approverEmail || "";
}

export function getPoApproverDisplayName(po) {
  const fromPo = String(po?.approval?.approverName || "").trim();
  if (fromPo) return fromPo;
  const routing = getSetupApprovalRouting();
  return routing.approverName || routing.approverEmail || "Approver";
}

/** PO is waiting for an approval decision. */
export function isPoAwaitingApproval(po) {
  if (!po) return false;
  const approvalStatusLower = String(po.approval?.status || "").toLowerCase();
  if (approvalStatusLower === "approved" || approvalStatusLower === "rejected") {
    return false;
  }
  if (approvalStatusLower === "pending") return true;
  const poStatusLower = String(po.status || "").toLowerCase();
  return poStatusLower === "issued";
}

/** Current session user matches the configured approver for this PO. */
export function isCurrentUserConfiguredApprover(po = null) {
  const userEmail = normalizeEmail(localStorage.getItem("userEmail") || "");
  if (!userEmail) return false;

  const approverEmail = normalizeEmail(getPoApproverEmail(po));
  if (approverEmail) {
    return approverEmail === userEmail;
  }

  const routing = getSetupApprovalRouting();
  return normalizeEmail(routing.approverEmail) === userEmail;
}

/** Show Review entry points in List / detail for the configured approver. */
export function canReviewAndApprovePo(po, { hasPoApprovalPermission } = {}) {
  if (!po || !isPoAwaitingApproval(po)) return false;
  if (typeof hasPoApprovalPermission === "boolean") {
    return hasPoApprovalPermission;
  }
  return isCurrentUserConfiguredApprover(po);
}

/** Whether the configured approver can act on this PO. */
export function canApprovePo(po) {
  return canReviewAndApprovePo(po);
}
