/**
 * BL-021A — Commercial Events canonical types, statuses and taxonomies (Doc 54).
 */

export const COMMERCIAL_EVENT_TYPES = {
  variation: { key: 'variation', label: 'Variation' },
  contraCharge: { key: 'contraCharge', label: 'Contra Charge' },
  credit: { key: 'credit', label: 'Credit' },
  budgetTransfer: { key: 'budgetTransfer', label: 'Budget Transfer' },
  employerInstruction: { key: 'employerInstruction', label: 'Employer Instruction' },
  salesUpgrade: { key: 'salesUpgrade', label: 'Sales Upgrade' },
  valueEngineering: { key: 'valueEngineering', label: 'Value Engineering' },
  other: { key: 'other', label: 'Other' },
};

export const COMMERCIAL_EVENT_STATUSES = {
  draft: { key: 'draft', label: 'Draft', modifier: 'draft' },
  submitted: { key: 'submitted', label: 'Submitted', modifier: 'pending' },
  approved: { key: 'approved', label: 'Approved', modifier: 'approved' },
  rejected: { key: 'rejected', label: 'Rejected', modifier: 'rejected' },
  includedInCertificate: {
    key: 'includedInCertificate',
    label: 'Included in Certificate',
    modifier: 'approved',
  },
  recovered: { key: 'recovered', label: 'Recovered', modifier: 'approved' },
  closed: { key: 'closed', label: 'Closed', modifier: 'muted' },
};

/** Statuses that affect committed package value (Doc 54 / BL-021A). */
export const PACKAGE_VALUE_STATUSES = new Set([
  COMMERCIAL_EVENT_STATUSES.approved.key,
  COMMERCIAL_EVENT_STATUSES.includedInCertificate.key,
  COMMERCIAL_EVENT_STATUSES.recovered.key,
  COMMERCIAL_EVENT_STATUSES.closed.key,
]);

/** Statuses visible as pending commercial movement. */
export const PENDING_PACKAGE_VALUE_STATUSES = new Set([
  COMMERCIAL_EVENT_STATUSES.draft.key,
  COMMERCIAL_EVENT_STATUSES.submitted.key,
]);

export const COMMERCIAL_EVENT_RESPONSIBILITIES = {
  employer: { key: 'employer', label: 'Employer' },
  consultant: { key: 'consultant', label: 'Consultant' },
  developer: { key: 'developer', label: 'Developer' },
  commercial: { key: 'commercial', label: 'Commercial' },
  siteTeam: { key: 'siteTeam', label: 'Site Team' },
  subcontractor: { key: 'subcontractor', label: 'Subcontractor' },
  purchaser: { key: 'purchaser', label: 'Purchaser' },
  utilityCompany: { key: 'utilityCompany', label: 'Utility Company' },
  unknown: { key: 'unknown', label: 'Unknown' },
};

export const COMMERCIAL_EVENT_VAT_TREATMENTS = {
  standard: { key: 'standard', label: 'Standard rated' },
  zeroRated: { key: 'zeroRated', label: 'Zero rated' },
  exempt: { key: 'exempt', label: 'Exempt' },
  outsideScope: { key: 'outsideScope', label: 'Outside scope' },
  unknown: { key: 'unknown', label: 'Unknown' },
};

export const COMMERCIAL_EVENT_CERTIFICATE_STATUSES = {
  notIncluded: { key: 'notIncluded', label: 'Not included' },
  pendingInclusion: { key: 'pendingInclusion', label: 'Pending inclusion' },
  included: { key: 'included', label: 'Included' },
};

export const COMMERCIAL_EVENT_RECOVERY_STATUSES = {
  notApplicable: { key: 'notApplicable', label: 'Not applicable' },
  pending: { key: 'pending', label: 'Pending recovery' },
  recovered: { key: 'recovered', label: 'Recovered' },
  writtenOff: { key: 'writtenOff', label: 'Written off' },
};

export const COMMERCIAL_EVENT_CATEGORIES = {
  design: {
    key: 'design',
    label: 'Design',
    subcategories: [
      { key: 'designChange', label: 'Design change' },
      { key: 'specificationChange', label: 'Specification change' },
      { key: 'drawingRevision', label: 'Drawing revision' },
      { key: 'other', label: 'Other' },
    ],
  },
  sales: {
    key: 'sales',
    label: 'Sales',
    subcategories: [
      { key: 'buyerUpgrade', label: 'Buyer upgrade' },
      { key: 'plotSpecific', label: 'Plot-specific change' },
      { key: 'salesIncentive', label: 'Sales incentive' },
      { key: 'other', label: 'Other' },
    ],
  },
  budget: {
    key: 'budget',
    label: 'Budget',
    subcategories: [
      { key: 'budgetTransfer', label: 'Budget transfer' },
      { key: 'contingencyRelease', label: 'Contingency release' },
      { key: 'reallocation', label: 'Reallocation' },
      { key: 'other', label: 'Other' },
    ],
  },
  production: {
    key: 'production',
    label: 'Production',
    subcategories: [
      { key: 'siteInstruction', label: 'Site instruction' },
      { key: 'programmeChange', label: 'Programme change' },
      { key: 'methodChange', label: 'Method change' },
      { key: 'other', label: 'Other' },
    ],
  },
  external: {
    key: 'external',
    label: 'External',
    subcategories: [
      { key: 'utilityWorks', label: 'Utility works' },
      { key: 'statutoryRequirement', label: 'Statutory requirement' },
      { key: 'thirdPartyDamage', label: 'Third party damage' },
      { key: 'other', label: 'Other' },
    ],
  },
  commercial: {
    key: 'commercial',
    label: 'Commercial',
    subcategories: [
      { key: 'scopeChange', label: 'Scope change' },
      { key: 'rateAdjustment', label: 'Rate adjustment' },
      { key: 'claimSettlement', label: 'Claim settlement' },
      { key: 'other', label: 'Other' },
    ],
  },
  recovery: {
    key: 'recovery',
    label: 'Recovery',
    subcategories: [
      { key: 'contraCharge', label: 'Contra charge' },
      { key: 'defectRectification', label: 'Defect rectification' },
      { key: 'backCharge', label: 'Back charge' },
      { key: 'other', label: 'Other' },
    ],
  },
  other: {
    key: 'other',
    label: 'Other',
    subcategories: [{ key: 'other', label: 'Other' }],
  },
};

export function listCommercialEventTypeOptions() {
  return Object.values(COMMERCIAL_EVENT_TYPES);
}

export function listCommercialEventStatusOptions() {
  return Object.values(COMMERCIAL_EVENT_STATUSES);
}

export function listCommercialEventCategoryOptions() {
  return Object.values(COMMERCIAL_EVENT_CATEGORIES);
}

export function listCommercialEventResponsibilityOptions() {
  return Object.values(COMMERCIAL_EVENT_RESPONSIBILITIES);
}

export function listCommercialEventVatTreatmentOptions() {
  return Object.values(COMMERCIAL_EVENT_VAT_TREATMENTS);
}

export function getCommercialEventTypeMeta(typeKey) {
  return COMMERCIAL_EVENT_TYPES[typeKey] || COMMERCIAL_EVENT_TYPES.other;
}

export function getCommercialEventStatusMeta(statusKey) {
  return (
    COMMERCIAL_EVENT_STATUSES[statusKey] || {
      key: statusKey,
      label: statusKey,
      modifier: 'default',
    }
  );
}

export function getCommercialEventCategoryMeta(categoryKey) {
  return (
    COMMERCIAL_EVENT_CATEGORIES[categoryKey] || COMMERCIAL_EVENT_CATEGORIES.other
  );
}

export function getCommercialEventSubcategoryMeta(categoryKey, subcategoryKey) {
  const category = getCommercialEventCategoryMeta(categoryKey);
  return (
    category.subcategories.find((item) => item.key === subcategoryKey) || {
      key: subcategoryKey,
      label: subcategoryKey,
    }
  );
}

export function getCommercialEventResponsibilityMeta(responsibilityKey) {
  return (
    COMMERCIAL_EVENT_RESPONSIBILITIES[responsibilityKey] ||
    COMMERCIAL_EVENT_RESPONSIBILITIES.unknown
  );
}

export function isCommercialEventEditable(statusKey) {
  return statusKey === COMMERCIAL_EVENT_STATUSES.draft.key;
}

export function canSubmitCommercialEvent(statusKey) {
  return statusKey === COMMERCIAL_EVENT_STATUSES.draft.key;
}

export function canApproveCommercialEvent(statusKey) {
  return statusKey === COMMERCIAL_EVENT_STATUSES.submitted.key;
}

export function canRejectCommercialEvent(statusKey) {
  return statusKey === COMMERCIAL_EVENT_STATUSES.submitted.key;
}

export function canCloseCommercialEvent(statusKey) {
  return (
    statusKey === COMMERCIAL_EVENT_STATUSES.approved.key ||
    statusKey === COMMERCIAL_EVENT_STATUSES.includedInCertificate.key ||
    statusKey === COMMERCIAL_EVENT_STATUSES.recovered.key
  );
}
