/**
 * BL-016F.4 — Central BuildLite numbering service.
 * All modules should generate document numbers through this service.
 */

import { getCompanySettings } from './companyStore';
import { listDevelopments } from '../developments/developmentStore';

export const NUMBERING_TYPES = {
  development: { settingsKey: 'development', defaultPrefix: 'DEV-', defaultPad: 3 },
  purchaseOrder: { settingsKey: 'purchaseOrder', defaultPrefix: 'PO-', defaultPad: 6 },
  paymentCertificate: { settingsKey: 'paymentCertificate', defaultPrefix: 'PC-', defaultPad: 6 },
  salesPlot: { settingsKey: 'salesPlot', defaultPrefix: 'SP-', defaultPad: 3 },
  cvr: { settingsKey: 'cvr', defaultPrefix: 'CVR-', defaultPad: 3 },
  variationOrder: { settingsKey: 'variationOrder', defaultPrefix: 'VO-', defaultPad: 3 },
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getNumberingPrefix(type, settings = null) {
  const config = NUMBERING_TYPES[type];
  if (!config) {
    throw new Error(`Unknown numbering type: ${type}`);
  }

  const company = settings || getCompanySettings();
  const raw = company.numberingPrefixes?.[config.settingsKey];
  const prefix = String(raw ?? config.defaultPrefix).trim();
  return prefix || config.defaultPrefix;
}

export function parseNumberingValue(value, prefixRaw) {
  const prefix = String(prefixRaw || '').trim();
  if (!prefix) return null;

  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`, 'i');
  const match = String(value || '').trim().match(pattern);
  if (!match) return null;

  return {
    sequence: Number.parseInt(match[1], 10),
    width: match[1].length,
  };
}

export function generateNextNumber(type, existingValues = [], settings = null) {
  const config = NUMBERING_TYPES[type];
  if (!config) {
    throw new Error(`Unknown numbering type: ${type}`);
  }

  const prefix = getNumberingPrefix(type, settings);
  let maxSequence = 0;
  let width = config.defaultPad;

  for (const value of existingValues) {
    const parsed = parseNumberingValue(value, prefix);
    if (!parsed) continue;
    maxSequence = Math.max(maxSequence, parsed.sequence);
    width = Math.max(width, parsed.width);
  }

  const next = maxSequence + 1;
  return `${prefix}${String(next).padStart(width, '0')}`;
}

export function generateNextDevelopmentNumber(settings = null) {
  return generateNextNumber(
    'development',
    listDevelopments().map((item) => item.jobNumber),
    settings
  );
}

export function generateNextPurchaseOrderNumber(existingValues = [], settings = null) {
  return generateNextNumber('purchaseOrder', existingValues, settings);
}

export function generateNextPaymentCertificateNumber(existingValues = [], settings = null) {
  return generateNextNumber('paymentCertificate', existingValues, settings);
}

export function generateNextSalesPlotNumber(existingValues = [], settings = null) {
  return generateNextNumber('salesPlot', existingValues, settings);
}

export function previewNextDevelopmentNumber(settings = null) {
  return generateNextDevelopmentNumber(settings);
}
