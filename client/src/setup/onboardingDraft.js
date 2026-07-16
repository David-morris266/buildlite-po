/**
 * BL-016F — Onboarding draft (localStorage — resume across sessions).
 */

const ONBOARDING_DRAFT_KEY = 'buildlite_onboarding_draft_v1';

export const EMPTY_COMPANY = {
  companyName: '',
  tradingName: '',
  companyNumber: '',
  vatNumber: '',
  addressLine1: '',
  addressLine2: '',
  town: '',
  postcode: '',
  financialYearStart: '04-01',
  currency: 'GBP',
};

export const EMPTY_COMMERCIAL_DEFAULTS = {
  defaultRetentionPercent: 5,
  vatRate: 20,
  defaultForecastBehaviour: 'Committed',
  numberingPrefixes: {
    development: 'DEV-',
    purchaseOrder: 'PO-',
    paymentCertificate: 'PC-',
    cvr: 'CVR-',
    variationOrder: 'VO-',
    salesPlot: 'SP-',
  },
};

export const EMPTY_COST_CODES = {
  mode: '',
  importSummary: null,
  demoInstalled: false,
  importCommitted: false,
};

export const EMPTY_SUPPLIER = {
  name: '',
  addressLine1: '',
  addressLine2: '',
  town: '',
  postcode: '',
  vatNumber: '',
  termsDays: 30,
  preferredTrade: '',
  supplierId: '',
};

export const EMPTY_APPROVAL = {
  poApproverName: '',
  poApproverEmail: '',
  certificateApproverName: '',
  certificateApproverEmail: '',
  cvrApproverName: '',
  cvrApproverEmail: '',
};

export const EMPTY_DEVELOPMENT = {
  developmentName: '',
  developmentCode: '',
  client: '',
  targetStart: '',
  targetCompletion: '',
  developmentId: '',
};

function emptyDraft() {
  return {
    step: 1,
    company: { ...EMPTY_COMPANY },
    commercialDefaults: { ...EMPTY_COMMERCIAL_DEFAULTS },
    costCodes: { ...EMPTY_COST_CODES },
    supplier: { ...EMPTY_SUPPLIER },
    approval: { ...EMPTY_APPROVAL },
    development: { ...EMPTY_DEVELOPMENT },
    updatedAt: null,
  };
}

export function loadOnboardingDraft() {
  try {
    const raw = localStorage.getItem(ONBOARDING_DRAFT_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw);
    return {
      ...emptyDraft(),
      ...parsed,
      company: { ...EMPTY_COMPANY, ...(parsed.company || {}) },
      commercialDefaults: {
        ...EMPTY_COMMERCIAL_DEFAULTS,
        ...(parsed.commercialDefaults || {}),
        numberingPrefixes: {
          ...EMPTY_COMMERCIAL_DEFAULTS.numberingPrefixes,
          ...(parsed.commercialDefaults?.numberingPrefixes || {}),
        },
      },
      costCodes: { ...EMPTY_COST_CODES, ...(parsed.costCodes || {}) },
      supplier: { ...EMPTY_SUPPLIER, ...(parsed.supplier || {}) },
      approval: { ...EMPTY_APPROVAL, ...(parsed.approval || {}) },
      development: { ...EMPTY_DEVELOPMENT, ...(parsed.development || {}) },
    };
  } catch {
    return emptyDraft();
  }
}

export function saveOnboardingDraft(draft) {
  const next = { ...draft, updatedAt: new Date().toISOString() };
  localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(next));
  return next;
}

export function validateCompanyStep(company) {
  const errors = {};
  if (!String(company.companyName || '').trim()) errors.companyName = 'Company name is required.';
  if (!String(company.addressLine1 || '').trim()) errors.addressLine1 = 'Address is required.';
  if (!String(company.town || '').trim()) errors.town = 'Town or city is required.';
  if (!String(company.postcode || '').trim()) errors.postcode = 'Postcode is required.';
  return errors;
}

export function validateCommercialDefaultsStep(defaults) {
  const errors = {};
  if (!Number.isFinite(Number(defaults.vatRate))) errors.vatRate = 'VAT rate is required.';
  if (!Number.isFinite(Number(defaults.defaultRetentionPercent))) {
    errors.defaultRetentionPercent = 'Retention is required.';
  }
  return errors;
}

export function validateSupplierStep(supplier) {
  const errors = {};
  if (!String(supplier.name || '').trim()) errors.name = 'Supplier name is required.';
  return errors;
}

export function validateDevelopmentStep(development) {
  const errors = {};
  if (!String(development.developmentName || '').trim()) {
    errors.developmentName = 'Development name is required.';
  }
  return errors;
}

export function validateCostCodesStep(costCodes, masterCount = 0) {
  const errors = {};
  if (masterCount === 0) {
    errors.costCodes = 'Import cost codes or install the demo structure to continue.';
    return errors;
  }
  if (!costCodes.importSummary && !costCodes.importCommitted) {
    errors.costCodes = 'Review the import summary before continuing.';
  }
  return errors;
}

export function buildRegisteredOffice(company) {
  return [
    company.addressLine1,
    company.addressLine2,
    [company.town, company.postcode].filter(Boolean).join(', '),
  ]
    .filter((line) => String(line || '').trim())
    .join('\n');
}
