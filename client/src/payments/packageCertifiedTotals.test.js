import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import {
  approveCertificate,
  createCertificate,
  submitCertificate,
} from './paymentCertificateStore';
import { ensurePackageRecord } from './subcontractPackageStore';
import {
  calculateCommercialProgressPct,
  calculatePackageCertifiedGross,
  calculatePackageCertifiedNet,
  calculateRemainingContractValue,
  getApprovedCertificateGrossValue,
  getApprovedCertificateNetPayment,
} from './packageCertifiedTotals';
import {
  calculatePackageCertifiedValue,
  getApprovedCertificateValue,
} from '../cvr/cvrCertifiedValue';

const ORDER_KEY = 'dev-025::sup-1::0120';
const baseOrder = {
  orderKey: ORDER_KEY,
  developmentId: 'dev-025',
  supplierId: 'sup-1',
  costCode: '0120',
  committedValue: 100000,
};

function approveCertWithTotals(gross, net) {
  const created = createCertificate(ORDER_KEY, baseOrder);
  submitCertificate(ORDER_KEY, created.certificate.id);
  approveCertificate(ORDER_KEY, created.certificate.id, {
    grossThisCertificate: gross,
    netPayment: net,
  });
  return created.certificate.id;
}

describe('BL-025.1 packageCertifiedTotals', () => {
  beforeEach(() => {
    storage.clear();
    ensurePackageRecord(ORDER_KEY, baseOrder);
    localStorage.setItem('userName', 'Test QS');
  });

  it('returns zero gross and net when no certificates exist', () => {
    expect(calculatePackageCertifiedGross(ORDER_KEY)).toBe(0);
    expect(calculatePackageCertifiedNet(ORDER_KEY)).toBe(0);
  });

  it('sums gross from one approved certificate', () => {
    approveCertWithTotals(40000, 45600);
    expect(calculatePackageCertifiedGross(ORDER_KEY)).toBe(40000);
  });

  it('sums gross across multiple approved certificates', () => {
    approveCertWithTotals(25000, 28000);
    approveCertWithTotals(15000, 16800);
    expect(calculatePackageCertifiedGross(ORDER_KEY)).toBe(40000);
  });

  it('excludes draft and submitted certificates from gross totals', () => {
    approveCertWithTotals(10000, 11000);
    const draft = createCertificate(ORDER_KEY, baseOrder);

    expect(calculatePackageCertifiedGross(ORDER_KEY)).toBe(10000);
    expect(getApprovedCertificateGrossValue(draft.certificate)).toBe(0);

    submitCertificate(ORDER_KEY, draft.certificate.id);
    expect(calculatePackageCertifiedGross(ORDER_KEY)).toBe(10000);
  });

  it('keeps gross and net totals distinct', () => {
    approveCertWithTotals(40000, 45600);
    expect(calculatePackageCertifiedGross(ORDER_KEY)).toBe(40000);
    expect(calculatePackageCertifiedNet(ORDER_KEY)).toBe(45600);
    expect(getApprovedCertificateNetPayment({
      status: 'locked',
      grossValue: 40000,
      netValue: 45600,
    })).toBe(45600);
  });

  it('calculates remaining as current contract minus gross certified', () => {
    expect(calculateRemainingContractValue(110000, 40000)).toBe(70000);
  });

  it('returns null remaining when current contract is unavailable', () => {
    expect(calculateRemainingContractValue(null, 30000)).toBeNull();
  });

  it('calculates commercial progress from gross certified and current contract', () => {
    expect(calculateCommercialProgressPct(40000, 110000)).toBe(36);
  });

  it('uses gross works for CVR certified cost, not certificate net payment', () => {
    approveCertWithTotals(40000, 45600);
    expect(calculatePackageCertifiedValue(ORDER_KEY)).toBe(40000);
    expect(
      getApprovedCertificateValue({
        status: 'locked',
        grossValue: 40000,
        netValue: 45600,
      })
    ).toBe(40000);
    expect(
      getApprovedCertificateValue({
        status: 'locked',
        grossValue: 60000,
        netValue: null,
      })
    ).toBe(60000);
  });
});
