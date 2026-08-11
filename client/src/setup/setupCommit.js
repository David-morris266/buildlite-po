/**
 * BL-016F — Commit onboarding sections to Administration master data stores.
 */

import { saveCompanySettings } from '../admin/companyStore';
import { addCostCodeMasterRecord, getCostCodeMasterStore, listCostCodeMasterRecords } from '../admin/costCodeMasterStore';
import { saveApprovalSettings } from '../admin/approvalSettingsStore';
import { listClients, addClient } from '../admin/clientStore';
import { generateNextDevelopmentNumber } from '../admin/numberingService';
import { createSupplier } from '../api';
import { createDevelopment } from '../developments/developmentStore';
import { DEMO_COST_CODES } from './demoCostCodes';
import {
  buildRegisteredOffice,
  EMPTY_APPROVAL,
  EMPTY_COMMERCIAL_DEFAULTS,
  EMPTY_COMPANY,
  EMPTY_DEVELOPMENT,
  EMPTY_SUPPLIER,
} from './onboardingDraft';
import { markSectionComplete } from './setupProgressStore';
import { saveSetupDraft, EMPTY_BUSINESS, EMPTY_DEFAULTS, EMPTY_FIRST_ORDER, EMPTY_APPROVAL as LEGACY_APPROVAL } from './setupDraft';

function markCostCodeStoreReady() {
  const store = getCostCodeMasterStore();
  if (store.seededFromServer) return store;
  localStorage.setItem(
    'buildlite_cost_codes_master_v1',
    JSON.stringify({ ...store, seededFromServer: true, updatedAt: new Date().toISOString() })
  );
  return getCostCodeMasterStore();
}

export function commitCompanySection(company = EMPTY_COMPANY) {
  const registeredOffice = buildRegisteredOffice(company);
  saveCompanySettings({
    companyName: company.companyName,
    tradingName: company.tradingName || company.companyName,
    companyNumber: company.companyNumber,
    vatRegistrationNumber: company.vatNumber,
    registeredOffice,
    registeredAddress: registeredOffice,
    currency: company.currency || 'GBP',
    financialYearStart: company.financialYearStart || '04-01',
  });
  markSectionComplete('company');
  syncLegacySetupDraft({ company });
  return { ok: true };
}

export function commitCommercialDefaultsSection(defaults = EMPTY_COMMERCIAL_DEFAULTS) {
  saveCompanySettings({
    vatRate: Number(defaults.vatRate) || 20,
    defaultRetentionPercent: Number(defaults.defaultRetentionPercent) || 5,
    defaultForecastBehaviour: defaults.defaultForecastBehaviour || 'Committed',
    numberingPrefixes: defaults.numberingPrefixes,
  });
  markSectionComplete('commercialDefaults');
  syncLegacySetupDraft({ commercialDefaults: defaults });
  return { ok: true };
}

export function installDemoCostCodes() {
  let imported = 0;
  const existing = new Set(
    listCostCodeMasterRecords().map((item) => String(item.code).trim().toLowerCase())
  );

  for (const record of DEMO_COST_CODES) {
    if (existing.has(record.code.toLowerCase())) continue;
    const result = addCostCodeMasterRecord(record);
    if (result.ok) {
      imported += 1;
      existing.add(record.code.toLowerCase());
    }
  }

  markCostCodeStoreReady();
  return { ok: true, imported, mode: 'demo' };
}

export function commitCostCodesSection(costCodes = {}) {
  const masterCount = listCostCodeMasterRecords().length;
  if (masterCount === 0) {
    return {
      ok: false,
      error: 'Import cost codes or install the demo structure before continuing.',
    };
  }

  markCostCodeStoreReady();
  markSectionComplete('costCodes');
  return {
    ok: true,
    mode: costCodes.mode || 'import',
    ...(costCodes.importSummary || {}),
  };
}

export function commitCostCodeImportSection(summary = {}) {
  return commitCostCodesSection({ mode: 'import', importSummary: summary });
}

export async function commitSupplierSection(supplier = EMPTY_SUPPLIER) {
  const payload = {
    name: supplier.name,
    address1: supplier.addressLine1,
    address2: supplier.addressLine2,
    city: supplier.town,
    postcode: supplier.postcode,
    vatNumber: supplier.vatNumber,
    termsDays: Number(supplier.termsDays) || 30,
    preferredTrade: supplier.preferredTrade || '',
    supplierType: 'subcontractor',
    approvedSupplier: true,
    active: true,
  };

  let saved = null;
  if (supplier.supplierId) {
    saved = { id: supplier.supplierId, ...payload };
  } else {
    saved = await createSupplier(payload);
  }

  markSectionComplete('supplier');
  syncLegacySetupDraft({ supplier: { ...supplier, supplierId: saved?.id || supplier.supplierId } });
  return { ok: true, supplier: saved };
}

export function commitApprovalSection(approval = EMPTY_APPROVAL) {
  saveApprovalSettings({
    purchaseOrders: {
      status: 'configured',
      label: 'Configured',
      description: 'Default purchase order approver from Setup Assistant.',
      approverName: approval.poApproverName,
      approverEmail: approval.poApproverEmail,
    },
    paymentCertificates: {
      status: 'configured',
      label: 'Configured',
      description: 'Default payment certificate approver from Setup Assistant.',
      approverName: approval.certificateApproverName,
      approverEmail: approval.certificateApproverEmail,
    },
    cvrs: {
      status: 'configured',
      label: 'Configured',
      description: 'Default CVR approver from Setup Assistant.',
      approverName: approval.cvrApproverName,
      approverEmail: approval.cvrApproverEmail,
    },
  });

  if (approval.poApproverEmail) {
    localStorage.setItem('userEmail', approval.poApproverEmail);
  }
  if (approval.poApproverName) {
    localStorage.setItem('userName', approval.poApproverName);
  }

  markSectionComplete('approval');
  syncLegacySetupDraft({ approval });
  return { ok: true };
}

export async function commitDevelopmentSection(development = EMPTY_DEVELOPMENT) {
  const clientName = String(development.client || '').trim();
  if (clientName) {
    const existingClients = listClients();
    const alreadyExists = existingClients.some(
      (client) => client.name.toLowerCase() === clientName.toLowerCase()
    );
    if (!alreadyExists) {
      addClient({ name: clientName, active: true });
    }
  }

  const developmentCode = String(development.developmentCode || '').trim()
    || generateNextDevelopmentNumber();

  let savedDevelopment = null;
  if (development.developmentId) {
    savedDevelopment = { id: development.developmentId };
  } else {
    savedDevelopment = await createDevelopment({
      developmentName: development.developmentName,
      jobNumber: developmentCode,
      client: clientName,
      startDate: development.targetStart,
      targetCompletion: development.targetCompletion,
      status: 'planning',
    });
  }

  markSectionComplete('development');
  syncLegacySetupDraft({
    development: {
      ...development,
      developmentCode,
      developmentId: savedDevelopment?.id,
    },
  });
  return { ok: true, development: savedDevelopment };
}

export function commitSetupComplete() {
  markSectionComplete('complete');
  return { ok: true };
}

function syncLegacySetupDraft({
  company,
  commercialDefaults,
  supplier,
  approval,
  development,
} = {}) {
  try {
    const business = company
      ? {
          ...EMPTY_BUSINESS,
          companyName: company.companyName,
          tradingName: company.tradingName || company.companyName,
          addressLine1: company.addressLine1,
          addressLine2: company.addressLine2,
          town: company.town,
          postcode: company.postcode,
          vatNumber: company.vatNumber,
          companyNumber: company.companyNumber,
        }
      : EMPTY_BUSINESS;

    const defaults = commercialDefaults
      ? {
          ...EMPTY_DEFAULTS,
          vatRate: Number(commercialDefaults.vatRate || 20) / 100,
          retentionRate: Number(commercialDefaults.defaultRetentionPercent || 5) / 100,
          paymentTerms: String(supplier?.termsDays || 30),
          poNumberPrefix: 'PO-',
          poNumberPrefixCustom: commercialDefaults.numberingPrefixes?.purchaseOrder || 'PO-',
          currency: company?.currency || 'GBP',
        }
      : EMPTY_DEFAULTS;

    const firstOrder = supplier
      ? {
          ...EMPTY_FIRST_ORDER,
          supplierName: supplier.name,
          supplierId: supplier.supplierId || '',
          jobName: development?.developmentName || '',
          jobCode: development?.developmentCode || '',
          jobId: development?.developmentId || '',
        }
      : EMPTY_FIRST_ORDER;

    const legacyApproval = approval
      ? {
          mode: 'other',
          approverName: approval.poApproverName,
          approverEmail: approval.poApproverEmail,
        }
      : LEGACY_APPROVAL;

    saveSetupDraft(7, business, { accentColor: '#7CFF6B' }, defaults, firstOrder, legacyApproval);
  } catch {
    /* legacy sync is best-effort */
  }
}
