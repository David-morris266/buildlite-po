/**
 * BL-016F — BuildLite first-time onboarding steps.
 */
export const SETUP_TOTAL_STEPS = 8;

export const SETUP_FORM_IDS = {
  company: 'setup-form-company',
  commercial: 'setup-form-commercial',
  supplier: 'setup-form-supplier',
  approval: 'setup-form-approval',
  development: 'setup-form-development',
};

export const SETUP_STEPS = [
  { id: 'welcome', label: 'Welcome', progressTitle: 'Welcome to BuildLite' },
  { id: 'company', label: 'Company Details', progressTitle: 'Company Details', sectionId: 'company' },
  { id: 'commercial', label: 'Commercial Defaults', progressTitle: 'Commercial Defaults', sectionId: 'commercialDefaults' },
  { id: 'cost-codes', label: 'Cost Codes', progressTitle: 'Cost Code Import', sectionId: 'costCodes' },
  { id: 'supplier', label: 'First Supplier', progressTitle: 'First Supplier', sectionId: 'supplier' },
  { id: 'approval', label: 'Approval Defaults', progressTitle: 'Approval Defaults', sectionId: 'approval' },
  { id: 'development', label: 'First Development', progressTitle: 'First Development', sectionId: 'development' },
  { id: 'ready', label: 'Ready to Go', progressTitle: 'BuildLite is ready', sectionId: 'complete' },
];
