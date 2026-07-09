/**
 * BL-012B — CVR store facade (period-ready persistence API).
 */

export {
  CVR_CURRENT_PERIOD,
  CVR_DEFAULT_PERIOD_KEY,
  ensureCvrRecord,
  getCvrRecord,
  getActivePeriodKey,
  getPeriodData,
  listCostCentres,
  getCostCentre,
  getCostCentreByKey,
  getDevelopmentNotes,
  updateDevelopmentNotes,
  addCostCentre,
  updateCostCentre,
  deactivateCostCentre,
  deleteCostCentre,
  upsertAutoCostCentre,
} from './costCentreStore';

export {
  listCvrPeriods,
  getCvrPeriod,
  findDraftCvrPeriod,
  getEditablePeriodKey,
  createOrOpenDraftPeriod,
  createNextCvrPeriod,
  submitCvrPeriod,
  approveCvrPeriod,
  rejectCvrPeriod,
  getCvrPeriodStatusMeta,
  isCvrPeriodEditable,
  isCvrPeriodLocked,
  isCvrPeriodSubmitted,
} from './cvrPeriodStore';

export {
  buildCvrModel,
  buildCvrRows,
  buildPackagesForCostCentre,
  buildLedgerRowsForCostCentre,
  buildCertificatesForCostCentre,
  buildCertifiedByCostCode,
  ensureDiscoveredCostCentres,
} from './cvrEngine';
