import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { saveCompanySettings } from './companyStore';
import { createDevelopment } from '../developments/developmentStore';
import {
  generateNextDevelopmentNumber,
  generateNextNumber,
  generateNextPaymentCertificateNumber,
  generateNextPurchaseOrderNumber,
  generateNextCommercialEventNumber,
  parseNumberingValue,
} from './numberingService';

describe('numberingService', () => {
  beforeEach(() => storage.clear());

  it('generates dashed development numbers from company settings', () => {
    saveCompanySettings({
      numberingPrefixes: { development: 'DEV-' },
    });

    expect(generateNextDevelopmentNumber()).toBe('DEV-001');
    createDevelopment({ jobNumber: 'DEV-001', developmentName: 'Alpha' });
    expect(generateNextDevelopmentNumber()).toBe('DEV-002');
  });

  it('generates compact development numbers without a separator', () => {
    saveCompanySettings({
      numberingPrefixes: { development: 'DEV' },
    });

    expect(generateNextDevelopmentNumber()).toBe('DEV001');
    createDevelopment({ jobNumber: 'DEV001', developmentName: 'Alpha' });
    expect(generateNextDevelopmentNumber()).toBe('DEV002');
  });

  it('generates purchase order and certificate numbers with module padding', () => {
    saveCompanySettings({
      numberingPrefixes: {
        purchaseOrder: 'PO-',
        paymentCertificate: 'PC-',
      },
    });

    expect(generateNextPurchaseOrderNumber()).toBe('PO-000001');
    expect(generateNextPaymentCertificateNumber()).toBe('PC-000001');
    expect(
      generateNextPurchaseOrderNumber(['PO-000001', 'PO-000014'])
    ).toBe('PO-000015');
  });

  it('parses only values that match the configured prefix', () => {
    expect(parseNumberingValue('DEV-004', 'DEV-')).toEqual({
      sequence: 4,
      width: 3,
    });
    expect(parseNumberingValue('PO-000014', 'PO-')).toEqual({
      sequence: 14,
      width: 6,
    });
    expect(parseNumberingValue('OTHER-001', 'DEV-')).toBeNull();
  });

  it('generates commercial event numbers with CE prefix', () => {
    saveCompanySettings({
      numberingPrefixes: { commercialEvent: 'CE-' },
    });

    expect(generateNextCommercialEventNumber()).toBe('CE-0001');
    expect(generateNextCommercialEventNumber(['CE-0001', 'CE-0009'])).toBe('CE-0010');
  });

  it('preserves existing sequence width when generating the next number', () => {
    saveCompanySettings({
      numberingPrefixes: { development: 'DEV-' },
    });

    expect(
      generateNextNumber('development', ['DEV-0009', 'DEV-0010'])
    ).toBe('DEV-0011');
  });
});
