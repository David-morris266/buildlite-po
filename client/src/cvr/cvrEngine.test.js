import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockCertificates = vi.hoisted(() => new Map());
const mockOrders = vi.hoisted(() => []);

vi.mock('../payments/paymentCertificateStore.js', () => ({
  isApprovedCommercialCertificate: (certificate) => {
    const status = certificate?.status;
    return status === 'approved' || status === 'locked';
  },
  listCertificates: (orderKey) => mockCertificates.get(orderKey) || [],
  resolveCertificatesForPackage: (orderKey) => ({
    ready: true,
    certificates: mockCertificates.get(orderKey) || [],
    loadState: 'local',
    error: null,
  }),
}));

vi.mock('../payments/subcontractOrders.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildSubcontractOrdersFromPos: () => mockOrders,
  };
});

import { buildCertifiedByCostCode } from './cvrEngine.js';

describe('buildCertifiedByCostCode', () => {
  beforeEach(() => {
    mockCertificates.clear();
    mockOrders.length = 0;
  });

  it('aggregates certified value by cost code across subcontract packages', () => {
    mockOrders.push(
      {
        orderKey: 'dev-1::alpha::brickwork',
        developmentId: 'dev-1',
        costCode: 'brickwork',
      },
      {
        orderKey: 'dev-1::beta::brickwork',
        developmentId: 'dev-1',
        costCode: 'brickwork',
      }
    );

    setCertificates('dev-1::alpha::brickwork', [
      { status: 'locked', grossValue: 50000 },
    ]);
    setCertificates('dev-1::beta::brickwork', [
      { status: 'locked', grossValue: 30000 },
    ]);

    const result = buildCertifiedByCostCode('dev-1', []);

    expect(result.totals.get('brickwork')).toBe(80000);
    expect(result.hasPackage.has('brickwork')).toBe(true);
  });
});

function setCertificates(orderKey, certificates) {
  mockCertificates.set(orderKey, certificates);
}
