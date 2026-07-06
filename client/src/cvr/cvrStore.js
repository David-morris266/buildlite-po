/**
 * BL-012B — CVR store facade (period-ready persistence API).
 */

export {
  CVR_CURRENT_PERIOD,
  ensureCvrRecord,
  getCvrRecord,
  getActivePeriodKey,
  getPeriodData,
  listCostCentres,
  getCostCentre,
  getDevelopmentNotes,
  updateDevelopmentNotes,
  addCostCentre,
  updateCostCentre,
  deactivateCostCentre,
  deleteCostCentre,
  upsertAutoCostCentre,
} from './costCentreStore';

export {
  buildCvrModel,
  buildCvrRows,
  buildPackagesForCostCentre,
  buildLedgerRowsForCostCentre,
  ensureDiscoveredCostCentres,
} from './cvrEngine';
