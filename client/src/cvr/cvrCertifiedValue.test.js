import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  calculateOutstandingCertified,
  calculatePackageCertifiedValue,
  getApprovedCertificateValue,
  getOutstandingCertifiedState,
  enrichCvrCertifiedFields,
} from './cvrCertifiedValue.js';

const mockCertificates = vi.hoisted(() => new Map());

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

function setCertificates(orderKey, certificates) {
  mockCertificates.set(orderKey, certificates);
}

describe('getApprovedCertificateValue', () => {
  it('returns approved certificate gross value', () => {
    expect(
      getApprovedCertificateValue({ status: 'locked', grossValue: 60000, netValue: null })
    ).toBe(60000);
  });

  it('uses frozen gross works, not certificate net', () => {
    expect(
      getApprovedCertificateValue({ status: 'locked', netValue: 2150, grossValue: 2250 })
    ).toBe(2250);
  });

  it('adds signed recovery to gross works for CVR certified cost', () => {
    expect(
      getApprovedCertificateValue({
        status: 'locked',
        grossValue: 2250,
        netValue: 2150,
        recoverySigned: -100,
      })
    ).toBe(2150);
  });

  it('reconstructs recovery from frozen commercial lines when header is absent', () => {
    expect(
      getApprovedCertificateValue({
        status: 'locked',
        grossValue: 24000,
        netValue: 19800,
        commercialLines: [
          { lineType: 'recoveryDeduction', amountThisCertificate: -3000 },
        ],
      })
    ).toBe(21000);
  });

  it('does not inflate certified cost with VAT', () => {
    expect(
      getApprovedCertificateValue({
        status: 'locked',
        grossValue: 1000,
        retention: 0,
        vat: 200,
        netValue: 1200,
        recoverySigned: 0,
      })
    ).toBe(1000);
  });

  it('does not reduce certified cost for retention timing', () => {
    expect(
      getApprovedCertificateValue({
        status: 'locked',
        grossValue: 1000,
        retention: 50,
        vat: 0,
        netValue: 950,
        recoverySigned: 0,
      })
    ).toBe(1000);
  });

  it('ignores draft certificates', () => {
    expect(
      getApprovedCertificateValue({ status: 'draft', grossValue: 40000, netValue: null })
    ).toBe(0);
  });

  it('ignores submitted certificates', () => {
    expect(
      getApprovedCertificateValue({ status: 'submitted', grossValue: 40000, netValue: null })
    ).toBe(0);
  });
});

describe('calculatePackageCertifiedValue', () => {
  beforeEach(() => {
    mockCertificates.clear();
  });

  it('aggregates only approved certificates', () => {
    setCertificates('dev::supplier::cc1', [
      { status: 'draft', grossValue: 40000 },
      { status: 'locked', grossValue: 60000 },
    ]);

    expect(calculatePackageCertifiedValue('dev::supplier::cc1')).toBe(60000);
  });

  it('sums multiple approved certificates', () => {
    setCertificates('dev::supplier::cc1', [
      { status: 'locked', grossValue: 50000 },
      { status: 'locked', grossValue: 30000 },
    ]);

    expect(calculatePackageCertifiedValue('dev::supplier::cc1')).toBe(80000);
  });
});

describe('calculateOutstandingCertified', () => {
  it('Test 1: certified ahead of ledger', () => {
    expect(calculateOutstandingCertified(80000, 50000)).toBe(30000);
  });

  it('Test 2: certified matched by ledger', () => {
    expect(calculateOutstandingCertified(120000, 120000)).toBe(0);
  });

  it('never returns negative outstanding', () => {
    expect(calculateOutstandingCertified(50000, 80000)).toBe(0);
  });
});

describe('getOutstandingCertifiedState', () => {
  it('uses warning styling when certified exceeds actual', () => {
    expect(getOutstandingCertifiedState(80000, 50000)).toBe('warning');
  });

  it('stays neutral when outstanding is zero', () => {
    expect(getOutstandingCertifiedState(120000, 120000)).toBe('neutral');
  });
});

describe('enrichCvrCertifiedFields', () => {
  it('adds outstanding certified to a CVR row', () => {
    const row = enrichCvrCertifiedFields({
      committed: 200000,
      certified: 80000,
      actualCost: 50000,
    });

    expect(row.outstandingCertified).toBe(30000);
    expect(row.outstandingCertifiedState).toBe('warning');
  });
});

describe('BL-012E validation scenarios', () => {
  beforeEach(() => {
    mockCertificates.clear();
  });

  it('Test 1: committed, certified and actual commercial facts', () => {
    const row = enrichCvrCertifiedFields({
      committed: 200000,
      certified: 80000,
      actualCost: 50000,
    });

    expect(row.committed).toBe(200000);
    expect(row.certified).toBe(80000);
    expect(row.actualCost).toBe(50000);
    expect(row.outstandingCertified).toBe(30000);
  });

  it('Test 2: no outstanding when ledger matches certified', () => {
    const row = enrichCvrCertifiedFields({
      certified: 120000,
      actualCost: 120000,
    });

    expect(row.outstandingCertified).toBe(0);
    expect(row.outstandingCertifiedState).toBe('neutral');
  });

  it('Test 3: draft certificate ignored in package aggregation', () => {
    setCertificates('dev-1::brickwork::brickwork', [
      { status: 'draft', grossValue: 40000 },
      { status: 'locked', grossValue: 60000 },
    ]);

    expect(calculatePackageCertifiedValue('dev-1::brickwork::brickwork')).toBe(60000);
  });
});
