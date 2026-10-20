import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./developmentStore', () => ({
  getDevelopmentStatusMeta: () => ({ label: 'Live', modifier: 'live' }),
}));
vi.mock('./plotMaster', () => ({ getPlotCount: (development) => development.plotCount || 0 }));
vi.mock('../ledger/ledgerTransactionStore', () => ({
  getTotalActualCost: () => 0,
  getTransactionCount: () => 0,
}));
vi.mock('../payments/paymentCertificateStore', () => ({
  isApprovedCommercialCertificate: () => true,
  listCertificates: () => [],
}));
vi.mock('../payments/subcontractOrders', () => ({
  buildSubcontractOrdersFromPos: (pos) => pos,
  getPoOrderScopeId: (po) => po.developmentId,
}));
vi.mock('../payments/packageIdentityMerge', () => ({
  mergeServerPackagesWithPoOrders: (serverPackages) => serverPackages,
}));

import { buildDevelopmentWorkspaceModel, formatDevelopmentListRow } from './developmentHelpers';

describe('development presentation model', () => {
  const development = {
    id: 'dev-1', developmentName: 'Oak Meadow', status: 'live', plotCount: 0,
    packageCount: 0, updatedAt: '2026-10-20T08:00:00.000Z',
  };

  beforeEach(() => vi.clearAllMocks());

  it('does not present the stored create-time packageCount default as a genuine zero', () => {
    const row = formatDevelopmentListRow(development);
    expect(row.plotsLabel).toBe('0');
    expect(row.packagesLabel).toBe('Unavailable');
  });

  it('builds exactly four operational KPIs and removes the unsupported Forecast placeholder', () => {
    const model = buildDevelopmentWorkspaceModel(development, {
      pos: [], serverPackages: [], posReady: true, packagesReady: true, certificatesReady: true,
    });
    expect(model.summaryCards.map((card) => card.label)).toEqual([
      'Plots', 'Purchase Orders', 'Packages', 'Certificates',
    ]);
    expect(model.summaryCards.map((card) => card.value)).toEqual(['0', '0', '0', '0']);
  });

  it('fails unavailable asynchronous evidence closed instead of displaying zero', () => {
    const model = buildDevelopmentWorkspaceModel(development, {
      pos: [], serverPackages: null, posReady: false, packagesReady: false, certificatesReady: false,
    });
    expect(model.summaryCards.map((card) => card.value)).toEqual([
      '0', 'Unavailable', 'Unavailable', 'Unavailable',
    ]);
  });
});
