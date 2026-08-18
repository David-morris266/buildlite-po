/**
 * @vitest-environment jsdom
 * BL-030B — Payment Certificates certificate hydration + financial safety.
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const listPOs = vi.hoisted(() => vi.fn());
const certificateAuthorityEnabled = vi.hoisted(() => ({ value: false }));

vi.mock('../api', () => ({
  listPOs,
}));

vi.mock('../payments/paymentCertificateAuthority', () => ({
  isPaymentCertificateServerAuthorityEnabled: () => certificateAuthorityEnabled.value,
}));

vi.mock('../commercialEvents/commercialEventAuthority', () => ({
  isCommercialEventServerAuthorityEnabled: () => false,
  canUseCommercialEventsForFinancials: () => true,
}));

vi.mock('../payments/orderMatrixAuthority', () => ({
  isOrderMatrixServerAuthorityEnabled: () => false,
}));

vi.mock('../api/paymentCertificates', () => import('../test/mockPaymentCertificateApi'));
vi.mock('../api/packages', () => import('../test/mockPackageApi'));

import {
  buildLockedServerCertificateFixture,
  getPaymentCertificateCreateCallCount,
  getPaymentCertificateMutationCallCount,
  resetPaymentCertificateApiStore,
  setPaymentCertificateListDelay,
  setPaymentCertificateListReject,
} from '../test/mockPaymentCertificateApi';
import { resetPackageApiStore, seedMockPackage } from '../test/mockPackageApi';
import { __resetPaymentCertificateServerCacheForTests } from '../payments/paymentCertificateServerCache';
import { ensurePackageRecord } from '../payments/subcontractPackageStore';
import { saveOrderMatrix } from '../payments/orderMatrixStore';
import { createCertificate } from '../payments/paymentCertificateStore';
import PaymentCertificates from './PaymentCertificates';
import SubcontractPackageWorkspace from './SubcontractPackageWorkspace';

const DEV_ID = 'dev-1785599776666-zck5pl';
const ORDER_KEY = `${DEV_ID}::sup-1786363489252::5215 — electrical — electrical`;
const PACKAGE_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

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

const order = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  scopeId: DEV_ID,
  jobId: DEV_ID,
  packageUuid: PACKAGE_UUID,
  packageId: PACKAGE_UUID,
  supplierId: 'sup-1786363489252',
  costCode: '5215 — electrical — electrical',
  supplierLabel: 'Sparktastic Ltd',
  projectLabel: 'Test Site 1',
  committedValue: 100000,
  poNumbers: ['S0007'],
  pos: [sparktasticPo],
};

describe('Payment Certificates / package workspace certificate hydration (BL-030B)', () => {
  let networkGuard;
  let container;
  let root;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    certificateAuthorityEnabled.value = true;
    __resetPaymentCertificateServerCacheForTests();
    resetPaymentCertificateApiStore();
    resetPackageApiStore();
    localStorage.clear();
    ensurePackageRecord(ORDER_KEY, order);
    saveOrderMatrix(ORDER_KEY, {
      layout: 'plot-stage',
      plots: [{ id: 'plot-1', label: 'Plot 12', values: [100000] }],
      stages: ['Stage 1'],
    });
    seedMockPackage({
      id: PACKAGE_UUID,
      orderKey: ORDER_KEY,
      developmentId: DEV_ID,
      supplierId: 'sup-1786363489252',
      costCode: '5215 — electrical — electrical',
      supplierLabel: 'Sparktastic Ltd',
    });
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

  it('Payment Certificates route shows loading then loaded server certificates', async () => {
    setPaymentCertificateListDelay(80);
    buildLockedServerCertificateFixture({
      packageId: PACKAGE_UUID,
      orderKey: ORDER_KEY,
      grossValue: 24000,
      netValue: 22800,
    });

    await act(async () => {
      root.render(
        <PaymentCertificates initialOrderKey={ORDER_KEY} initialTab="certificates" />
      );
    });
    await flushPromises();

    expect(document.body.textContent).toMatch(/Loading certificate data/i);
    expect(document.body.textContent).not.toMatch(/Create Certificate No\. 1/);
    expect(document.body.textContent).not.toMatch(/£24k/);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    await flushPromises();

    const text = document.body.textContent;
    expect(text).not.toMatch(/Loading certificate data/i);
    expect(text).toMatch(/Certificate No/);
    expect(text).not.toMatch(/No Payment Certificates have been created/);
  });

  it('Developments package workspace hydrates and rerenders after loading', async () => {
    setPaymentCertificateListDelay(80);
    buildLockedServerCertificateFixture({
      packageId: PACKAGE_UUID,
      orderKey: ORDER_KEY,
      grossValue: 24000,
    });

    await act(async () => {
      root.render(
        <SubcontractPackageWorkspace order={order} initialTab="overview" />
      );
    });
    await flushPromises();

    expect(document.body.textContent).toMatch(/Loading certificate data/i);
    expect(document.body.textContent).not.toMatch(/£24k/);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    await flushPromises();

    expect(document.body.textContent).toMatch(/£24k/);
    expect(document.body.textContent).not.toMatch(/Loading certificate data/i);
  });

  it('genuine loaded empty enables the existing create-certificate empty state', async () => {
    await act(async () => {
      root.render(
        <PaymentCertificates initialOrderKey={ORDER_KEY} initialTab="certificates" />
      );
    });
    await flushPromises();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await flushPromises();

    expect(document.body.textContent).toMatch(/No Payment Certificates have been created/);
    expect(document.body.textContent).toMatch(/Create Certificate No\. 1/);
    const createButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent.includes('Create Certificate No. 1')
    );
    expect(createButton?.disabled).toBe(false);
  });

  it('create is disabled while certificate cache is loading', async () => {
    setPaymentCertificateListDelay(80);

    await act(async () => {
      root.render(
        <PaymentCertificates initialOrderKey={ORDER_KEY} initialTab="certificates" />
      );
    });
    await flushPromises();

    expect(document.body.textContent).toMatch(/Loading certificate data/i);
    const createButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent.includes('Create Certificate No. 1')
    );
    expect(createButton).toBeFalsy();
  });

  it('create uses the server create API and opens the returned draft', async () => {
    await act(async () => {
      root.render(
        <PaymentCertificates initialOrderKey={ORDER_KEY} initialTab="certificates" />
      );
    });
    await flushPromises();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await flushPromises();

    const createButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent.includes('Create Certificate No. 1')
    );
    expect(createButton).toBeTruthy();
    await act(async () => {
      createButton.click();
    });
    await flushPromises();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await flushPromises();

    expect(getPaymentCertificateCreateCallCount()).toBe(1);
    expect(getPaymentCertificateMutationCallCount()).toBe(1);
    expect(document.body.textContent).toMatch(/Certificate No\. 1/i);
  });

  it('does not fall back to localStorage certificates when authority is ON', async () => {
    certificateAuthorityEnabled.value = false;
    createCertificate(ORDER_KEY, order);
    certificateAuthorityEnabled.value = true;
    setPaymentCertificateListReject();

    await act(async () => {
      root.render(
        <PaymentCertificates initialOrderKey={ORDER_KEY} initialTab="certificates" />
      );
    });
    await flushPromises();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await flushPromises();

    expect(document.body.textContent).toMatch(/Unable to load certificate data/i);
    expect(document.body.textContent).not.toMatch(/No Payment Certificates have been created/);
    expect(document.body.textContent).not.toMatch(/Create Certificate No\. 1/);
  });
});
