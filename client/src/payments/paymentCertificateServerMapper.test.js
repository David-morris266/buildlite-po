import { describe, expect, it } from 'vitest';
import {
  normalizeServerPaymentCertificate,
  normalizeServerPaymentCertificateList,
} from './paymentCertificateServerMapper';

describe('paymentCertificateServerMapper (BL-030B)', () => {
  it('normalises camelCase server documents into client certificate shape', () => {
    const mapped = normalizeServerPaymentCertificate({
      id: 'cert-1',
      packageId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      orderKey: 'dev::sup::0120',
      certificateNumber: 2,
      status: 'locked',
      certificateDate: '2026-08-01',
      contractualValuationDate: '2026-08-31',
      paymentTimetable: { state: 'live', readiness: 'ready' },
      hasSubmissionHistory: true,
      progress: { 'plot-1::Foundations': { thisCertificatePct: 50 } },
      commercialLines: [{ id: 'cel-1', amountThisCertificate: 1000 }],
      valuationSnapshot: { contractValue: 100000 },
      grossValue: 24000,
      netValue: 22800,
      version: 3,
      createdAt: '2026-08-01T10:00:00.000Z',
      createdBy: 'QS',
      submittedAt: '2026-08-01T11:00:00.000Z',
      submittedBy: 'QS',
      approvedAt: '2026-08-01T12:00:00.000Z',
      approvedBy: 'CM',
      auditHistory: [{ id: 'a1', action: 'approved', actor: 'CM', at: '2026-08-01T12:00:00.000Z' }],
    });

    expect(mapped).toMatchObject({
      id: 'cert-1',
      packageUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      orderKey: 'dev::sup::0120',
      certificateNumber: 2,
      status: 'locked',
      certificateDate: '2026-08-01',
      contractualValuationDate: '2026-08-31',
      grossValue: 24000,
      netValue: 22800,
      version: 3,
      createdBy: 'QS',
      approvedBy: 'CM',
    });
    expect(mapped.progress['plot-1::Foundations'].thisCertificatePct).toBe(50);
    expect(mapped.commercialLines).toHaveLength(1);
    expect(mapped.auditHistory[0].action).toBe('approved');
    expect(mapped.paymentTimetable).toMatchObject({ state: 'live', readiness: 'ready' });
    expect(mapped.hasSubmissionHistory).toBe(true);
  });

  it('maps approved status to locked and reads frozen totals aliases', () => {
    const mapped = normalizeServerPaymentCertificate({
      id: 'cert-2',
      package_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      order_key: 'dev::sup::0120',
      certificate_number: 1,
      status: 'approved',
      totals: {
        grossWorksThisCertificate: 10000,
        netPayment: 9500,
      },
    });

    expect(mapped.status).toBe('locked');
    expect(mapped.grossValue).toBe(10000);
    expect(mapped.netValue).toBe(9500);
    expect(mapped.packageUuid).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(mapped.orderKey).toBe('dev::sup::0120');
  });

  it('sorts lists by certificate number and drops invalid rows', () => {
    const listed = normalizeServerPaymentCertificateList([
      { id: 'b', certificateNumber: 2, status: 'draft' },
      { certificateNumber: 9, status: 'draft' },
      { id: 'a', certificateNumber: 1, status: 'locked' },
    ]);

    expect(listed.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
