import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const authorityEnabled = vi.hoisted(() => ({ value: true }));

vi.mock('./paymentCertificateAuthority', () => ({
  isPaymentCertificateServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../api/paymentCertificates', () => import('../test/mockPaymentCertificateApi'));

import { resetPaymentCertificateApiStore } from '../test/mockPaymentCertificateApi';
import {
  __resetPaymentCertificateServerCacheForTests,
  rememberPackageUuidForOrderKey,
  replaceCachedCertificates,
} from './paymentCertificateServerCache';
import {
  buildCertificateValuationGrid,
  getPreviousProgressForCell,
  summarizeCertificateProgress,
} from './paymentCertificateProgress';
import { buildStableCellId } from './paymentCertificateCellIdentity';

const DEV_ID = 'dev-bl030c-snap';
const ORDER_KEY = `${DEV_ID}::sup-1::0120`;
const PACKAGE_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-dddddddddddd';
const CERT_1 = 'cert-locked-1';
const CERT_2 = 'cert-draft-2';

const order = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  packageUuid: PACKAGE_UUID,
};

const liveMatrix = {
  layout: 'plot-stage',
  stages: ['Second Fix', 'First Fix', 'Snagging'],
  plots: [
    { id: 'plot-2', label: 'Plot 2 moved', values: [500, 800, 100] },
    { id: 'plot-1', label: 'Plot 1 live', values: [11111, 22222, 50] },
    { id: 'plot-3', label: 'Plot 3 added', values: [10, 20, 30] },
  ],
};

describe('approved snapshot and Cert 2 previous progress (BL-030C)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    __resetPaymentCertificateServerCacheForTests();
    resetPaymentCertificateApiStore();
    rememberPackageUuidForOrderKey(ORDER_KEY, PACKAGE_UUID);
    replaceCachedCertificates(PACKAGE_UUID, [
      {
        id: CERT_1,
        packageUuid: PACKAGE_UUID,
        orderKey: ORDER_KEY,
        certificateNumber: 1,
        status: 'locked',
        grossValue: 4000,
        netValue: 3800,
        retention: 200,
        vat: 0,
        version: 4,
        progress: {
          [buildStableCellId('plot-1', 'First Fix')]: {
            plotId: 'plot-1',
            stageKey: 'First Fix',
            thisCertificatePct: 40,
          },
        },
        valuationSnapshot: {
          snapshotVersion: 1,
          capturedAt: '2026-08-01T12:00:00.000Z',
          totals: { grossWorksThisCertificate: 4000, netPayment: 3800 },
          cells: [
            {
              cellId: buildStableCellId('plot-1', 'First Fix'),
              plotId: 'plot-1',
              plotLabel: 'Historic Plot 1',
              stageKey: 'First Fix',
              stageLabel: 'First Fix',
              contractValue: 10000,
              previousCumulativePct: 0,
              thisCertificatePct: 40,
              cumulativePct: 40,
              previousValue: 0,
              thisCertificateValue: 4000,
              certifiedToDateValue: 4000,
              remainingValue: 6000,
            },
          ],
        },
      },
      {
        id: CERT_2,
        packageUuid: PACKAGE_UUID,
        orderKey: ORDER_KEY,
        certificateNumber: 2,
        status: 'draft',
        version: 1,
        progress: {},
        commercialLines: [],
      },
    ]);
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('locked historical view uses valuationSnapshot even when the live matrix changed', () => {
    const summary = summarizeCertificateProgress(ORDER_KEY, CERT_1, order);
    expect(summary.fromValuationSnapshot).toBe(true);
    expect(summary.frozenTotals).toBe(true);
    expect(summary.grid.cells[0].plotLabel).toBe('Historic Plot 1');
    expect(summary.grid.cells[0].contractValue).toBe(10000);
    expect(summary.totals.grossWorksThisCertificate).toBe(4000);
    expect(summary.totals.netPayment).toBe(3800);
    expect(summary.grid.cells.some((cell) => cell.plotLabel === 'Plot 3 added')).toBe(false);
  });

  it('Cert 2 previous cumulative % follows stable identity after reorder/add/value change', () => {
    const previous = getPreviousProgressForCell(ORDER_KEY, { certificateNumber: 2 }, '1::1', {
      order,
      matrix: liveMatrix,
    });
    expect(previous.previousCumulativePct).toBe(40);

    const added = getPreviousProgressForCell(ORDER_KEY, { certificateNumber: 2 }, '2::2', {
      order,
      matrix: liveMatrix,
    });
    expect(added.previousCumulativePct).toBe(0);

    const grid = buildCertificateValuationGrid(ORDER_KEY, { certificateNumber: 2, status: 'draft', progress: {} }, liveMatrix, new Set(), {
      order,
      developmentId: DEV_ID,
    });
    const plot1FirstFix = grid.cells.find(
      (cell) => cell.plotLabel.includes('Plot 1') && cell.stageLabel === 'First Fix'
    );
    expect(plot1FirstFix.previousCumulativePct).toBe(40);
    expect(plot1FirstFix.contractValue).toBe(22222);

    const addedCell = grid.cells.find(
      (cell) => cell.plotLabel.includes('Plot 3') && cell.stageLabel === 'Snagging'
    );
    expect(addedCell.previousCumulativePct).toBe(0);
    expect(grid.cells.some((cell) => cell.stageLabel === 'Removed Stage')).toBe(false);
  });
});
