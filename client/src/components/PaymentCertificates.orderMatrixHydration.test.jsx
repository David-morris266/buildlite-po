/**
 * @vitest-environment jsdom
 * BL-029B — Payment Certificates Order Matrix hydration + stale view-model.
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const listPOs = vi.hoisted(() => vi.fn());
const matrixAuthorityEnabled = vi.hoisted(() => ({ value: false }));

vi.mock('../api', () => ({
  listPOs,
}));

vi.mock('../payments/orderMatrixAuthority', () => ({
  isOrderMatrixServerAuthorityEnabled: () => matrixAuthorityEnabled.value,
}));

vi.mock('../commercialEvents/commercialEventAuthority', () => ({
  isCommercialEventServerAuthorityEnabled: () => false,
  canUseCommercialEventsForFinancials: () => true,
}));

vi.mock('../api/orderMatrices', () => import('../test/mockOrderMatrixApi'));

import {
  buildPlotStageMatrixFixture,
  resetOrderMatrixApiStore,
  setOrderMatrixListDelay,
  setOrderMatrixListReject,
} from '../test/mockOrderMatrixApi';
import { __resetOrderMatrixServerCacheForTests } from '../payments/orderMatrixServerCache';
import { ensurePackageRecord } from '../payments/subcontractPackageStore';
import PaymentCertificates from './PaymentCertificates';

const DEV_ID = 'dev-1785599776666-zck5pl';
const ORDER_KEY_A = `${DEV_ID}::sup-1786363489252::5215 — electrical — electrical`;
const ORDER_KEY_B = `${DEV_ID}::sup-other::9999 — joinery`;
const PACKAGE_UUID_A = 'pkg-uuid-spark';

const sparktasticPo = {
  poNumber: 'S0007',
  type: 'S',
  status: 'Approved',
  approval: { status: 'Approved' },
  supplierId: 'sup-1786363489252',
  supplierSnapshot: { name: 'Sparktastic Ltd' },
  subtotal: 100000,
  costRef: {
    costCode: '5215 — Electrical — Electrical',
    developmentId: DEV_ID,
  },
  items: [{ costCode: '5215 — Electrical — Electrical', amount: 100000 }],
};

const joineryPo = {
  poNumber: 'S0008',
  type: 'S',
  status: 'Approved',
  approval: { status: 'Approved' },
  supplierId: 'sup-other',
  supplierSnapshot: { name: 'Joinery Co' },
  subtotal: 20000,
  costRef: {
    costCode: '9999 — Joinery',
    developmentId: DEV_ID,
  },
  items: [{ costCode: '9999 — Joinery', amount: 20000 }],
};

const orderA = {
  orderKey: ORDER_KEY_A,
  developmentId: DEV_ID,
  scopeId: DEV_ID,
  jobId: DEV_ID,
  supplierId: 'sup-1786363489252',
  costCode: '5215 — electrical — electrical',
  supplierLabel: 'Sparktastic Ltd',
  projectLabel: 'Test Site 1',
  committedValue: 100000,
  poNumbers: ['S0007'],
  pos: [sparktasticPo],
};

describe('PaymentCertificates order matrix hydration (BL-029B)', () => {
  let networkGuard;
  let container;
  let root;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    matrixAuthorityEnabled.value = true;
    __resetOrderMatrixServerCacheForTests();
    resetOrderMatrixApiStore();
    localStorage.clear();
    ensurePackageRecord(ORDER_KEY_A, orderA);
    listPOs.mockResolvedValue({ items: [sparktasticPo] });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
    vi.clearAllMocks();
  });

  async function flushPromises() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('shows loading then hydrates the package matrix automatically', async () => {
    setOrderMatrixListDelay(80);
    buildPlotStageMatrixFixture({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY_A,
      packageId: PACKAGE_UUID_A,
      plots: [{ id: 'plot-1', label: 'Plot 12', values: [500, 1000] }],
    });

    await act(async () => {
      root.render(
        <PaymentCertificates initialOrderKey={ORDER_KEY_A} initialTab="overview" />
      );
    });
    await flushPromises();

    expect(document.body.textContent).toMatch(/Loading matrix data/i);
    expect(document.body.textContent).not.toMatch(/Matrix Required/);
    expect(document.body.textContent).not.toContain('Plot 12');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    await flushPromises();

    const text = document.body.textContent;
    expect(text).not.toMatch(/Loading matrix data/i);
    expect(text).toMatch(/Imported/i);
    expect(text).not.toMatch(/Get started/i);
  });

  it('rebuilds a stale package view-model after matrix hydration completes', async () => {
    setOrderMatrixListDelay(60);
    buildPlotStageMatrixFixture({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY_A,
      packageId: PACKAGE_UUID_A,
    });

    await act(async () => {
      root.render(
        <PaymentCertificates initialOrderKey={ORDER_KEY_A} initialTab="matrix" />
      );
    });
    await flushPromises();
    expect(document.body.textContent).toMatch(/Loading matrix data/i);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await flushPromises();

    expect(document.body.textContent).toContain('Order Matrix');
    expect(document.body.textContent).toContain('Plot 1');
    expect(document.body.textContent).not.toMatch(/Loading matrix data/i);
    expect(document.body.textContent).not.toContain('Import your valuation matrix');
  });

  it('shows the existing empty/import state when loaded with no matrix', async () => {
    await act(async () => {
      root.render(
        <PaymentCertificates initialOrderKey={ORDER_KEY_A} initialTab="overview" />
      );
    });
    await flushPromises();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await flushPromises();

    expect(document.body.textContent).toMatch(/Get started/i);
    expect(document.body.textContent).toMatch(/Import your plot/i);
    expect(document.body.textContent).not.toMatch(/Loading matrix data/i);
  });

  it('does not show package A matrix on package B', async () => {
    buildPlotStageMatrixFixture({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY_A,
      packageId: PACKAGE_UUID_A,
      plots: [{ id: 'plot-a', label: 'Plot A-only', values: [100] }],
    });
    ensurePackageRecord(ORDER_KEY_B, {
      ...orderA,
      orderKey: ORDER_KEY_B,
      supplierId: 'sup-other',
      supplierLabel: 'Joinery Co',
      costCode: '9999 — joinery',
    });
    listPOs.mockResolvedValue({ items: [sparktasticPo, joineryPo] });

    await act(async () => {
      root.render(
        <PaymentCertificates initialOrderKey={ORDER_KEY_B} initialTab="matrix" />
      );
    });
    await flushPromises();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await flushPromises();

    expect(document.body.textContent).not.toContain('Plot A-only');
    expect(document.body.textContent).toContain('Import your valuation matrix');
  });

  it('surfaces API failure instead of localStorage fallback or Matrix Required', async () => {
    setOrderMatrixListReject(new Error('Order matrices unavailable'));

    await act(async () => {
      root.render(
        <PaymentCertificates initialOrderKey={ORDER_KEY_A} initialTab="overview" />
      );
    });
    await flushPromises();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await flushPromises();

    expect(document.body.textContent).toMatch(/Order matrices unavailable/i);
    expect(document.body.textContent).not.toMatch(/Matrix Required/);
    expect(document.body.textContent).not.toMatch(/Get started/i);
  });
});
