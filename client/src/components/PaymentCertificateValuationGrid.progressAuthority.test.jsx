/**
 * @vitest-environment jsdom
 * BL-030C UAT — Stage Details progress must PATCH through the real API wrapper.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';
import { buildStableCellId } from '../payments/paymentCertificateCellIdentity';
import { __resetPaymentCertificateMutationQueuesForTests } from '../payments/paymentCertificateServerMutations';
import {
  __resetPaymentCertificateServerCacheForTests,
  rememberPackageUuidForOrderKey,
  upsertCachedCertificate,
} from '../payments/paymentCertificateServerCache';
import { saveOrderMatrix } from '../payments/orderMatrixStore';
import { ensurePackageRecord } from '../payments/subcontractPackageStore';
import PaymentCertificateDetail from './PaymentCertificateDetail';

const certificateAuthorityEnabled = vi.hoisted(() => ({ value: true }));

vi.mock('../payments/paymentCertificateAuthority', () => ({
  isPaymentCertificateServerAuthorityEnabled: () => certificateAuthorityEnabled.value,
}));

vi.mock('../payments/orderMatrixAuthority', () => ({
  isOrderMatrixServerAuthorityEnabled: () => false,
}));

vi.mock('../commercialEvents/commercialEventAuthority', () => ({
  isCommercialEventServerAuthorityEnabled: () => false,
  canUseCommercialEventsForFinancials: () => true,
}));

vi.mock('./PaymentCertificateCommercialEvents', () => ({
  default: () => <div>Commercial events</div>,
}));

vi.mock('./PaymentCertificateRecoveryDeductions', () => ({
  default: () => <div>Recovery deductions</div>,
}));

const DEV_ID = 'dev-bl030c-grid-uat';
const ORDER_KEY = `${DEV_ID}::sup-wipe::5231 — cleaning — cleaning`;
const PACKAGE_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CERT_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const JOISTS_CELL_ID = buildStableCellId('plot-1-2', 'Joists');

const FORBIDDEN_PATCH_KEYS = new Set([
  'id',
  'clientId',
  'packageId',
  'packageUuid',
  'developmentId',
  'orderKey',
  'certificateNumber',
  'status',
  'grossValue',
  'netValue',
  'createdBy',
  'updatedAt',
  'audit',
  'auditHistory',
  'valuationSnapshot',
  'totals',
]);

const order = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  scopeId: DEV_ID,
  packageUuid: PACKAGE_UUID,
  packageId: PACKAGE_UUID,
  supplierId: 'sup-wipe',
  costCode: '5231 — cleaning — cleaning',
  supplierLabel: 'Wipe It Cleaners',
  projectLabel: 'Test Site 1',
};

const matrix = {
  layout: 'plot-stage',
  plots: [
    { id: 'plot-0-1', label: 'Plot 1', values: [0, 500] },
    { id: 'plot-1-2', label: 'Plot 2 / Arundel', values: [0, 750] },
  ],
  stages: ['Type', 'Joists'],
};

function draftCertificate(overrides = {}) {
  return {
    id: CERT_ID,
    packageId: PACKAGE_UUID,
    packageUuid: PACKAGE_UUID,
    orderKey: ORDER_KEY,
    certificateNumber: 1,
    status: 'draft',
    version: 1,
    progress: {},
    commercialLines: [],
    ...overrides,
  };
}

function changeInput(element, value) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  descriptor.set.call(element, value);
  const tracker = element._valueTracker;
  if (tracker) tracker.setValue('');
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function pressEnter(element) {
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function summaryValue(label) {
  const dt = [...document.querySelectorAll('dt')].find((node) => node.textContent === label);
  return dt?.nextElementSibling?.textContent || '';
}

function plot2JoistsCell() {
  return [...document.querySelectorAll('.po-cert-grid__cell')].find((node) => {
    const title = String(node.getAttribute('title') || '');
    return title.includes('Plot 2') && title.includes('Joists');
  });
}

describe('PaymentCertificateValuationGrid Stage Details progress (BL-030C UAT)', () => {
  let networkGuard;
  let container;
  let root;
  let patches;
  let serverCert;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    certificateAuthorityEnabled.value = true;
    __resetPaymentCertificateServerCacheForTests();
    __resetPaymentCertificateMutationQueuesForTests();
    localStorage.clear();
    localStorage.setItem('userName', 'UAT QS');
    ensurePackageRecord(ORDER_KEY, order);
    saveOrderMatrix(ORDER_KEY, matrix);
    rememberPackageUuidForOrderKey(ORDER_KEY, PACKAGE_UUID);
    serverCert = draftCertificate();
    upsertCachedCertificate(PACKAGE_UUID, serverCert);

    patches = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init = {}) => {
        const url = String(input);
        const method = String(init.method || 'GET').toUpperCase();
        if (method === 'PATCH' && url.includes(`/api/packages/${PACKAGE_UUID}/certificates/${CERT_ID}`)) {
          const payload = JSON.parse(init.body || '{}');
          patches.push(payload);
          const forbidden = Object.keys(payload).filter((key) => FORBIDDEN_PATCH_KEYS.has(key));
          if (forbidden.length) {
            return {
              ok: false,
              status: 400,
              statusText: 'Bad Request',
              text: async () =>
                JSON.stringify({
                  message: `These fields cannot be patched: ${forbidden.join(', ')}`,
                }),
            };
          }
          if (Number(payload.version) !== Number(serverCert.version)) {
            return {
              ok: false,
              status: 409,
              statusText: 'Conflict',
              text: async () =>
                JSON.stringify({
                  message: 'Payment certificate version conflict.',
                  certificate: serverCert,
                }),
            };
          }
          serverCert = {
            ...serverCert,
            progress: payload.progress || serverCert.progress,
            version: Number(serverCert.version) + 1,
          };
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(serverCert),
          };
        }
        throw new Error(`Unexpected fetch ${method} ${url}`);
      })
    );

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    networkGuard?.restore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function flushPromises() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function renderDetail() {
    await act(async () => {
      root.render(
        <PaymentCertificateDetail
          order={order}
          certificateId={CERT_ID}
          onBack={vi.fn()}
        />
      );
    });
    await flushPromises();
  }

  async function openJoistsStageDetails() {
    const cell = plot2JoistsCell();
    expect(cell).toBeTruthy();
    await act(async () => {
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await flushPromises();
    expect(document.querySelector('[aria-label="Stage details"]')).toBeTruthy();
  }

  it('Stage Details Set % and Complete PATCH stable identity and update the live grid', async () => {
    await renderDetail();
    expect(document.body.textContent).toMatch(/Certificate No\. 1/);
    expect(summaryValue('Assessment')).toMatch(/£0\.00/);
    expect(plot2JoistsCell()?.querySelector('.po-cert-grid__cell-pct')?.textContent).toBe('—');

    await openJoistsStageDetails();

    const pctInput = document.getElementById('po-cert-detail-pct');
    expect(pctInput).toBeTruthy();
    await act(async () => {
      changeInput(pctInput, '50');
    });
    await act(async () => {
      pressEnter(pctInput);
    });
    await flushPromises();
    await flushPromises();

    expect(patches).toHaveLength(1);
    expect(patches[0].createdBy).toBeUndefined();
    expect(patches[0].updatedBy).toBeUndefined();
    expect(patches[0].actor).toBe('UAT QS');
    expect(patches[0].version).toBe(1);
    expect(patches[0].progress[JOISTS_CELL_ID]).toEqual({
      plotId: 'plot-1-2',
      stageKey: 'Joists',
      thisCertificatePct: 50,
    });
    expect(patches[0].progress['1::1']).toBeUndefined();
    expect(plot2JoistsCell()?.querySelector('.po-cert-grid__cell-pct')?.textContent).toBe('50%');
    expect(summaryValue('Assessment')).toMatch(/£375\.00/);

    const complete = [...document.querySelector('[aria-label="Stage details"]').querySelectorAll('button')].find(
      (button) => button.textContent.includes('Complete')
    );
    expect(complete).toBeTruthy();
    await act(async () => {
      complete.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();
    await flushPromises();

    expect(patches).toHaveLength(2);
    expect(patches[1].createdBy).toBeUndefined();
    expect(patches[1].version).toBe(2);
    expect(patches[1].progress[JOISTS_CELL_ID]).toEqual({
      plotId: 'plot-1-2',
      stageKey: 'Joists',
      thisCertificatePct: 100,
    });
    expect(plot2JoistsCell()?.querySelector('.po-cert-grid__cell-pct')?.textContent).toBe('100% ✓');
    expect(summaryValue('Assessment')).toMatch(/£750\.00/);
  });

  it('treats Cert 2 input as cumulative progress and persists only the derived movement', async () => {
    const certificate1 = draftCertificate({
      id: 'cccccccc-bbbb-4ccc-8ddd-ffffffffffff',
      certificateNumber: 1,
      status: 'locked',
      progress: {
        [JOISTS_CELL_ID]: {
          plotId: 'plot-1-2',
          stageKey: 'Joists',
          thisCertificatePct: 25,
        },
      },
      valuationSnapshot: {
        cells: [
          {
            plotId: 'plot-1-2',
            stageKey: 'Joists',
            thisCertificatePct: 25,
          },
        ],
      },
    });
    serverCert = draftCertificate({ certificateNumber: 2 });
    upsertCachedCertificate(PACKAGE_UUID, certificate1);
    upsertCachedCertificate(PACKAGE_UUID, serverCert);

    await renderDetail();
    await openJoistsStageDetails();

    const panel = document.querySelector('[aria-label="Stage details"]');
    const pctInput = document.getElementById('po-cert-detail-pct');
    expect(panel?.textContent).toMatch(/Previous/);
    expect(panel?.textContent).toMatch(/Progress to date/);
    expect(pctInput.value).toBe('25');

    await act(async () => {
      changeInput(pctInput, '752');
    });
    expect(pctInput.value).toBe('752');
    expect(patches).toHaveLength(0);

    await act(async () => {
      changeInput(pctInput, '75');
    });
    expect(pctInput.value).toBe('75');
    expect(patches).toHaveLength(0);

    await act(async () => {
      pressEnter(pctInput);
    });
    await flushPromises();
    await flushPromises();

    expect(patches).toHaveLength(1);
    expect(patches[0].progress[JOISTS_CELL_ID].thisCertificatePct).toBe(50);
    expect(summaryValue('Assessment')).toMatch(/£375\.00/);
    expect(panel?.textContent).toMatch(/£187\.50/);
    expect(panel?.textContent).toMatch(/£562\.50/);

    await openJoistsStageDetails();
    expect(document.getElementById('po-cert-detail-pct').value).toBe('75');
  });

  it('allows a temporary blank without committing or corrupting progress', async () => {
    const certificate1 = draftCertificate({
      id: 'eeeeeeee-bbbb-4ccc-8ddd-ffffffffffff',
      certificateNumber: 1,
      status: 'locked',
      valuationSnapshot: {
        cells: [{ plotId: 'plot-1-2', stageKey: 'Joists', thisCertificatePct: 25 }],
      },
    });
    serverCert = draftCertificate({ certificateNumber: 2 });
    upsertCachedCertificate(PACKAGE_UUID, certificate1);
    upsertCachedCertificate(PACKAGE_UUID, serverCert);

    await renderDetail();
    await openJoistsStageDetails();
    const pctInput = document.getElementById('po-cert-detail-pct');
    expect(pctInput.value).toBe('25');

    await act(async () => {
      pctInput.focus();
      changeInput(pctInput, '');
    });
    expect(pctInput.value).toBe('');
    expect(patches).toHaveLength(0);

    await act(async () => {
      pressEnter(pctInput);
    });
    await flushPromises();
    expect(patches).toHaveLength(0);
    expect(document.getElementById('po-cert-detail-pct').value).toBe('');
    expect(summaryValue('Assessment')).toMatch(/£0\.00/);
  });

  it('rejects progress below the previously approved cumulative percentage', async () => {
    const certificate1 = draftCertificate({
      id: 'dddddddd-bbbb-4ccc-8ddd-ffffffffffff',
      certificateNumber: 1,
      status: 'locked',
      valuationSnapshot: {
        cells: [{ plotId: 'plot-1-2', stageKey: 'Joists', thisCertificatePct: 25 }],
      },
    });
    serverCert = draftCertificate({ certificateNumber: 2 });
    upsertCachedCertificate(PACKAGE_UUID, certificate1);
    upsertCachedCertificate(PACKAGE_UUID, serverCert);

    await renderDetail();
    await openJoistsStageDetails();
    await act(async () => {
      changeInput(document.getElementById('po-cert-detail-pct'), '20');
    });
    await act(async () => {
      pressEnter(document.getElementById('po-cert-detail-pct'));
    });
    await flushPromises();

    expect(patches).toHaveLength(0);
    expect(document.querySelector('[aria-label="Stage details"]')?.textContent).toMatch(
      /Progress cannot be reduced below the previously certified 25%\./
    );
  });

  it('surfaces a PATCH failure on the certificate page instead of swallowing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () => JSON.stringify({ message: 'Progress save failed on server' }),
      }))
    );

    await renderDetail();
    await openJoistsStageDetails();
    await act(async () => {
      const input = document.getElementById('po-cert-detail-pct');
      changeInput(input, '50');
    });
    await act(async () => {
      const input = document.getElementById('po-cert-detail-pct');
      pressEnter(input);
    });
    await flushPromises();
    await flushPromises();

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/Progress save failed on server/);
    expect(plot2JoistsCell()?.querySelector('.po-cert-grid__cell-pct')?.textContent).toBe('—');
  });
});
