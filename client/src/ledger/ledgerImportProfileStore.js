/**
 * BL-012A — Saved Purchase Ledger import profiles (localStorage).
 */

import { ensureLedger, getLedger } from './ledgerTransactionStore';
import { fieldByColumnToMapping } from './ledgerImportFields';

const STORAGE_KEY = 'buildlite_purchase_ledgers_v1';

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function newId() {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const DEFAULT_PROFILE_TEMPLATES = [
  {
    id: 'template-coins',
    name: 'COINS Purchase Ledger',
    headerMapping: {
      developmentIdentifier: 'Job',
      costCode: 'Cost Code',
      supplier: 'Supplier',
      transactionDate: 'Date',
      transactionAmount: 'Amount',
      description: 'Description',
      invoiceNumber: 'Invoice No',
      vat: 'VAT',
      supplierCode: 'Supplier Code',
      documentType: 'Document Type',
    },
    isTemplate: true,
  },
  {
    id: 'template-sage',
    name: 'Sage Purchase Ledger',
    headerMapping: {
      developmentIdentifier: 'Project Code',
      costCode: 'Cost Centre',
      supplier: 'Supplier Name',
      transactionDate: 'Date',
      transactionAmount: 'Net Amount',
      description: 'Details',
      invoiceNumber: 'Invoice Number',
      vat: 'VAT Amount',
      reference: 'Reference',
      supplierCode: 'Account Ref',
    },
    isTemplate: true,
  },
  {
    id: 'template-xero',
    name: 'Xero Bills',
    headerMapping: {
      developmentIdentifier: 'Tracking Name',
      costCode: 'Account Code',
      supplier: 'Contact',
      transactionDate: 'Date',
      transactionAmount: 'Net',
      description: 'Description',
      invoiceNumber: 'Invoice Number',
      vat: 'Tax',
      reference: 'Reference',
      documentType: 'Type',
    },
    isTemplate: true,
  },
];

export function listImportProfiles(developmentId) {
  const saved = getLedger(developmentId).importProfiles || [];
  return [...DEFAULT_PROFILE_TEMPLATES, ...saved];
}

export function saveImportProfile(developmentId, profile) {
  ensureLedger(developmentId);
  const all = readAll();
  const record = all[developmentId];
  const now = new Date().toISOString();
  const name = String(profile.name || '').trim();

  if (!name) {
    return { ok: false, errors: ['Profile name is required.'] };
  }

  const existingIndex = record.importProfiles.findIndex(
    (item) => item.name.toLowerCase() === name.toLowerCase()
  );

  const nextProfile = {
    id: profile.id && !profile.isTemplate ? profile.id : newId(),
    name,
    headerRowIndex: profile.headerRowIndex ?? 0,
    fieldByColumn: profile.fieldByColumn || [],
    headerMapping: fieldByColumnToMapping(profile.fieldByColumn || []),
    createdAt: profile.createdAt || now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    record.importProfiles[existingIndex] = {
      ...record.importProfiles[existingIndex],
      ...nextProfile,
    };
  } else {
    record.importProfiles.push(nextProfile);
  }

  all[developmentId] = record;
  writeAll(all);

  return { ok: true, profile: nextProfile };
}

export function deleteImportProfile(developmentId, profileId) {
  const all = readAll();
  const record = ensureLedger(developmentId);
  record.importProfiles = record.importProfiles.filter(
    (item) => item.id !== profileId
  );
  all[developmentId] = record;
  writeAll(all);
  return { ok: true };
}

export function getImportProfileById(developmentId, profileId) {
  return listImportProfiles(developmentId).find((item) => item.id === profileId) || null;
}
