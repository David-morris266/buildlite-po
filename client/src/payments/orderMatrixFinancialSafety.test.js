/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: false }));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./orderMatrixAuthority', () => ({
  isOrderMatrixServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../api/orderMatrices', () => import('../test/mockOrderMatrixApi'));

import { resetOrderMatrixApiStore } from '../test/mockOrderMatrixApi';
import {
  __resetOrderMatrixServerCacheForTests,
  ensureMatricesReadyForDevelopment,
} from './orderMatrixServerCache';
import { buildPackageViewModel } from './subcontractPackage';
import { getOrderMatrixSummary, getSubcontractOrderStatus } from './subcontractOrders';
import {
  buildCommercialSummaryItems,
  summarizeCertificateProgress,
} from './paymentCertificateProgress';
import { ensurePackageRecord } from './subcontractPackageStore';
import {
  createCertificate,
  submitCertificate,
  approveCertificate,
  getCertificate,
} from './paymentCertificateStore';

const DEV_ID = 'dev-matrix-finance';
const ORDER_KEY = `${DEV_ID}::sup-1::0120`;

const baseOrder = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  supplierId: 'sup-1',
  costCode: '0120',
  supplierLabel: 'Sparktastic',
  projectLabel: 'Test Site 1',
  committedValue: 100000,
  pos: [{ subtotal: 100000, vatRateDefault: 0, retentionRateDefault: 0.05 }],
};

function seedApprovedFrozenCertificate() {
  ensurePackageRecord(ORDER_KEY, baseOrder);
  const created = createCertificate(ORDER_KEY, baseOrder).certificate;
  submitCertificate(ORDER_KEY, created.id);
  approveCertificate(
    ORDER_KEY,
    created.id,
    {
      grossWorksThisCertificate: 50000,
      netPayment: 47500,
    },
    baseOrder
  );
  return getCertificate(ORDER_KEY, created.id);
}

describe('order matrix financial safety (BL-029B)', () => {
  beforeEach(() => {
    authorityEnabled.value = false;
    storage.clear();
    __resetOrderMatrixServerCacheForTests();
    resetOrderMatrixApiStore();
    ensurePackageRecord(ORDER_KEY, baseOrder);
  });

  it('returns unavailable/null readiness during loading, not £0 or Matrix Required', () => {
    authorityEnabled.value = true;

    const summary = getOrderMatrixSummary(ORDER_KEY, 100000);
    expect(summary.matrixReady).toBe(false);
    expect(summary.hasMatrix).toBe(false);
    expect(summary.certified).toBeNull();
    expect(summary.remaining).toBeNull();
    expect(summary.rowCount).toBeNull();

    const status = getSubcontractOrderStatus(baseOrder);
    expect(status.label).toBe('Loading matrix data…');
    expect(status.label).not.toBe('Matrix Required');

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.matrixReady).toBe(false);
    expect(pkg.matrixExists).toBe(false);
    expect(pkg.matrixPlotCount).toBeNull();
    expect(pkg.matrixStatusLabel).toBe('Loading matrix data…');
    expect(pkg.status.label).toBe('Loading matrix data…');
  });

  it('draft certificate progress is unavailable while matrix cache is loading', () => {
    authorityEnabled.value = true;
    const certificate = createCertificate(ORDER_KEY, baseOrder).certificate;
    const summary = summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder);

    expect(summary.matrixReady).toBe(false);
    expect(summary.totals).toBeNull();
    expect(summary.grid).toBeNull();

    const items = buildCommercialSummaryItems(summary.totals, { matrixReady: false });
    expect(items[0].value).toBe('Loading matrix data…');
    expect(items.map((item) => item.value).join(' ')).not.toMatch(/£0/);
  });

  it('approved frozen certificate totals remain readable while matrix hydration is pending', () => {
    authorityEnabled.value = true;
    const certificate = seedApprovedFrozenCertificate();
    const summary = summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder);

    expect(summary.matrixReady).toBe(false);
    expect(summary.frozenTotals).toBe(true);
    expect(summary.totals.grossThisCertificate).toBe(50000);
    expect(summary.totals.netPayment).toBe(47500);
    expect(summary.totals.grossThisCertificate).not.toBe(0);
    expect(summary.totals.netPayment).not.toBe(0);
  });

  it('genuine loaded absence is Matrix Required, not loading', async () => {
    authorityEnabled.value = true;
    await ensureMatricesReadyForDevelopment(DEV_ID);

    const status = getSubcontractOrderStatus(baseOrder);
    expect(status.label).toBe('Matrix Required');

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.matrixReady).toBe(true);
    expect(pkg.matrixExists).toBe(false);
    expect(pkg.matrixStatusLabel).toBe('Awaiting import');
  });
});
