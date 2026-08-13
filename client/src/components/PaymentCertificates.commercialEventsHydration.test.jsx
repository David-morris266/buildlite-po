/**
 * @vitest-environment jsdom
 * BL-028B.3c — Payment Certificates React lifecycle hydration regression.
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const listPOs = vi.hoisted(() => vi.fn());
const authorityEnabled = vi.hoisted(() => ({ value: false }));

vi.mock('../api', () => ({
  listPOs,
}));

vi.mock('../commercialEvents/commercialEventAuthority', () => ({
  isCommercialEventServerAuthorityEnabled: () => authorityEnabled.value,
  canUseCommercialEventsForFinancials: (developmentId) =>
    !authorityEnabled.value || Boolean(developmentId),
}));

vi.mock('../api/commercialEvents', () => import('../test/mockCommercialEventApi'));

import {
  buildApprovedVariationFixture,
  resetCommercialEventApiStore,
  seedMockCommercialEvent,
  setCommercialEventListDelay,
  setCommercialEventListReject,
} from '../test/mockCommercialEventApi';
import { __resetCommercialEventServerCacheForTests } from '../commercialEvents/commercialEventServerCache';
import { saveOrderMatrix } from '../payments/orderMatrixStore';
import { ensurePackageRecord } from '../payments/subcontractPackageStore';
import { COMMERCIAL_EVENT_STATUSES } from '../commercialEvents/commercialEventTypes';
import PaymentCertificates from './PaymentCertificates';

const DEV_ID = 'dev-1785599776666-zck5pl';
const ORDER_KEY = `${DEV_ID}::sup-1786363489252::5215 — electrical — electrical`;
const CE_0013_ID = 'ce-1786363649246-r6zg6h';
const CE_0016_ID = 'ce-1786448351364-agfajp';
const CE_0019_ID = 'ce-1786452815397-1d9sov';

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

const baseOrder = {
  orderKey: ORDER_KEY,
  developmentId: '',
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

function seedSparktasticServerEvents() {
  buildApprovedVariationFixture({
    id: CE_0013_ID,
    developmentId: DEV_ID,
    orderKey: ORDER_KEY,
    eventNumber: 'CE-0013',
    eventType: 'salesUpgrade',
    description: 'Elec extras',
    value: 10000,
  });
  buildApprovedVariationFixture({
    id: CE_0016_ID,
    developmentId: DEV_ID,
    orderKey: ORDER_KEY,
    eventNumber: 'CE-0016',
    eventType: 'contraCharge',
    description: 'charge Carpenter',
    value: 2500,
    status: COMMERCIAL_EVENT_STATUSES.closed.key,
  });
  seedMockCommercialEvent({
    id: CE_0019_ID,
    developmentId: DEV_ID,
    orderKey: ORDER_KEY,
    packageId: ORDER_KEY,
    eventNumber: 'CE-0019',
    eventType: 'contraCharge',
    category: 'recovery',
    responsibility: 'subcontractor',
    description: 'Repair works after electrical correction',
    value: -1500,
    financialTreatment: 'recoverableDeduction',
    relationshipType: 'recovery',
    status: COMMERCIAL_EVENT_STATUSES.closed.key,
    recoveryStatus: 'outstanding',
  });
}

function seedMatrix() {
  saveOrderMatrix(ORDER_KEY, {
    layout: 'plot-stage',
    plots: [{ label: '1', values: [100000] }],
    stages: ['Stage 1'],
  });
}

describe('PaymentCertificates authority-ON React hydration lifecycle (BL-028B.3c)', () => {
  let networkGuard;
  let container;
  let root;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = true;
    __resetCommercialEventServerCacheForTests();
    resetCommercialEventApiStore();
    localStorage.clear();
    ensurePackageRecord(ORDER_KEY, baseOrder);
    seedMatrix();
    seedSparktasticServerEvents();
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

  it('shows loading then hydrates dashboard financials and recovery position automatically', async () => {
    setCommercialEventListDelay(80);

    await act(async () => {
      root.render(
        <PaymentCertificates
          initialOrderKey={ORDER_KEY}
          initialTab="overview"
        />
      );
    });
    await flushPromises();

    expect(document.body.textContent).toMatch(/Loading commercial data/i);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    await flushPromises();

    const text = document.body.textContent;
    expect(text).toMatch(/\+£12\.5k/i);
    expect(text).toMatch(/£112\.5k/i);
    expect(text).not.toMatch(/Loading commercial data/i);
    expect(text).toMatch(/Recovery Position/i);
    expect(text).not.toMatch(/No recovery or contra charge events on this package/i);
    expect(text).toMatch(/Outstanding/i);
  });

  it('surfaces API failure instead of permanent loading', async () => {
    setCommercialEventListReject(new Error('Commercial Events unavailable'));

    await act(async () => {
      root.render(
        <PaymentCertificates
          initialOrderKey={ORDER_KEY}
          initialTab="overview"
        />
      );
    });
    await flushPromises();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await flushPromises();

    expect(document.body.textContent).toMatch(/Commercial Events unavailable/i);
    expect(document.body.textContent).not.toMatch(/£112,500\.00/);
  });
});
