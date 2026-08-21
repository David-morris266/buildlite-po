/**
 * BL-033D.1 — Development Prelims keys (client).
 */

export const PRELIMS_DRIVERS = {
  TIME: 'TIME',
  LUMP_SUM: 'LUMP_SUM',
};

export const PRELIMS_DRIVER_KEYS = Object.values(PRELIMS_DRIVERS);

export const PRELIMS_STATUSES = {
  ACTIVE: 'active',
  COMPLETE: 'complete',
  CANCELLED: 'cancelled',
};

export const PRELIMS_STATUS_KEYS = Object.values(PRELIMS_STATUSES);

export const TIME_BASES = {
  SITE_START: 'SITE_START',
  FIRST_COMPLETION: 'FIRST_COMPLETION',
  FINAL_COMPLETION: 'FINAL_COMPLETION',
  FIXED_DATE: 'FIXED_DATE',
};

export const TIME_BASIS_KEYS = Object.values(TIME_BASES);

export const TIME_BASIS_LABELS = {
  SITE_START: 'Site start',
  FIRST_COMPLETION: 'First completion',
  FINAL_COMPLETION: 'Final completion',
  FIXED_DATE: 'Fixed date',
};

export const PRELIMS_CALC_STATES = {
  RESOLVED: 'resolved',
  UNRESOLVED: 'unresolved',
  INVALID: 'invalid',
};

export const PRELIMS_UNRESOLVED_REASONS = {
  MISSING_PROGRAMME: 'MISSING_PROGRAMME',
  MISSING_SITE_START: 'MISSING_SITE_START',
  MISSING_FIRST_COMPLETION: 'MISSING_FIRST_COMPLETION',
  MISSING_FINAL_COMPLETION: 'MISSING_FINAL_COMPLETION',
  MISSING_FIXED_START_DATE: 'MISSING_FIXED_START_DATE',
  MISSING_FIXED_END_DATE: 'MISSING_FIXED_END_DATE',
  MISSING_REPORTING_MONTH: 'MISSING_REPORTING_MONTH',
  INVALID_SPAN: 'INVALID_SPAN',
  INVALID_RATE: 'INVALID_RATE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
};

export const PRELIMS_UNRESOLVED_LABELS = {
  MISSING_PROGRAMME: 'Programme dates are not available.',
  MISSING_SITE_START: 'Site start is not available.',
  MISSING_FIRST_COMPLETION: 'First completion is not set.',
  MISSING_FINAL_COMPLETION: 'Final completion is not available.',
  MISSING_FIXED_START_DATE: 'A fixed start date is required.',
  MISSING_FIXED_END_DATE: 'A fixed end date is required.',
  MISSING_REPORTING_MONTH: "No CVR reporting month is available. TIME will not invent today's date.",
  INVALID_SPAN: 'Start is after end.',
  INVALID_RATE: 'Monthly rate is invalid.',
  INVALID_AMOUNT: 'Lump-sum amount is invalid.',
};
