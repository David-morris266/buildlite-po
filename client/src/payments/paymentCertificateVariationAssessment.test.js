import { describe, expect, it } from 'vitest';
import { buildCertificateWorksTotals } from './paymentCertificateProgress';

describe('VA certificate assessment financial composition', () => {
  it('includes one £8k VA assessment exactly once with package retention and VAT', () => {
    const totals = buildCertificateWorksTotals([], {
      commercialLines: [{ id: 'variation-assessment:va-a1', lineType: 'valueInclusion', sourceType: 'variationAccountAssessment', amountThisCertificate: 8000 }],
      currentContractValue: 9000,
      previousGrossWorks: 0,
      previousCommercialEventCertified: 0,
      previousRetentionHeld: 0,
      priorRetentionRates: [],
      retentionRate: 0.05,
      vatRate: 0.2,
    });
    expect(totals.matrixGrossThisCertificate).toBe(0);
    expect(totals.commercialEventGrossThisCertificate).toBe(8000);
    expect(totals.grossWorksThisCertificate).toBe(8000);
    expect(totals.retention).toBe(400);
    expect(totals.vat).toBe(1520);
    expect(totals.netPayment).toBe(9120);
  });
});
