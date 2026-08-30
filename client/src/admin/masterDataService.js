export { getCompanySettings, saveCompanySettings, getDefaultCvrPeriod, getDefaultVatRate, getDefaultRetentionPercent, CVR_PERIOD_OPTIONS, FORECAST_BEHAVIOUR_OPTIONS } from './companyStore';
export {
  getCommercialStructure,
  getActiveHeads,
  getActiveHeadNames,
  getActiveFamilies,
  getActiveFamilyNames,
  getActiveTrades,
  getActiveTradeNames,
  getHeadFamilyMap,
  addCommercialHead,
  addCommercialFamily,
  addCommercialTrade,
  updateCommercialHead,
  updateCommercialFamily,
  updateCommercialTrade,
  archiveCommercialHead,
  archiveCommercialFamily,
  archiveCommercialTrade,
  reorderCommercialHead,
  reorderCommercialFamily,
  reorderCommercialTrade,
} from './commercialStructureStore';
export {
  ensureCostCodeMasterSeeded,
  listCostCodeMasterRecords,
  searchCostCodeMasterRecords,
  addCostCodeMasterRecord,
  updateCostCodeMasterRecord,
  countCostCodeHierarchyUsage,
  listActiveCostCodesForSelect,
  toCostCodeSelectShape,
} from './costCodeMasterStore';
export {
  getCommercialBehaviourSettings,
  getCommercialBehaviourForHead,
  saveCommercialBehaviour,
  saveAllCommercialBehaviours,
  FORECAST_SOURCE_OPTIONS,
} from './commercialBehaviourStore';
export {
  getCombinedHierarchyUsage,
  getHierarchyUsageSummary,
  countLivePoHierarchyUsage,
  countLiveCvrHierarchyUsage,
} from './masterDataUsage';
export {
  runMasterDataValidation,
  buildReportingStructurePreview,
} from './masterDataValidation';
export { listClients, addClient, updateClient } from './clientStore';
export { listUsers, addUser, updateUser } from './userStore';
export { getApprovalSettings } from './approvalSettingsStore';
export { subscribeMasterDataChanged } from './masterDataEvents';

export const ADMIN_VIEWS = [
  'landing',
  'company',
  'commercial-structure',
  'commercial-behaviour',
  'cost-codes',
  'reporting-preview',
  'validation-dashboard',
  'setup-data-import',
  'setup-assistant',
  'suppliers',
  'clients',
  'users',
  'approval-settings',
  'prelims-templates',
  'subcontract-terms',
  'developer-tools',
];

export function isAdminView(value) {
  return ADMIN_VIEWS.includes(value);
}

export function getAdminViewTitle(view) {
  const titles = {
    landing: 'Administration',
    company: 'Company',
    'commercial-structure': 'Commercial Cost Structure',
    'commercial-behaviour': 'Commercial Behaviour',
    'cost-codes': 'Cost Codes',
    'reporting-preview': 'Reporting Preview',
    'validation-dashboard': 'Validation Dashboard',
    'setup-data-import': 'Setup & Data Import',
    'setup-assistant': 'Setup & Data Import',
    suppliers: 'Suppliers',
    clients: 'Clients',
    users: 'Users',
    'approval-settings': 'Approval Settings',
    'prelims-templates': 'Prelims Templates',
    'subcontract-terms': 'Subcontract Terms',
    'developer-tools': 'Developer Tools',
  };
  return titles[view] || 'Administration';
}
