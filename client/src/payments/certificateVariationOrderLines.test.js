import { describe, expect, it } from 'vitest';
import { buildVariationOrderCertificateLine, validateVariationOrderDraftAmount, variationOrderLineKey } from './certificateVariationOrderLines';

const authority = {
  eligible: true, variationOrderId: 'vo-1', variationOrderLineId: 'line-1',
  variationOrderReference: 'PO-1/VO-0001', sourcePoNumber: 'PO-1', costCode: '5218',
  description: 'Issued works', issuedLineValue: 4500, previouslyCertifiedValue: 2000,
  remainingCertifiableValue: 2500,
};

describe('Issued VO certificate-line contract', () => {
  it('builds frozen discriminated VO provenance without overloading commercialEventId', () => {
    const line = buildVariationOrderCertificateLine(authority, 1000);
    expect(line).toMatchObject({
      lineType: 'valueInclusion', sourceType: 'variationOrder', variationOrderId: 'vo-1',
      variationOrderLineId: 'line-1', sourceReference: 'PO-1/VO-0001', sourcePoNumber: 'PO-1',
      sourceCostCode: '5218', description: 'Issued works', sourceValue: 4500,
      sourcePreviouslyCertified: 2000, sourceRemainingAtAdd: 2500, amountThisCertificate: 1000,
    });
    expect(line.commercialEventId).toBeUndefined();
    expect(variationOrderLineKey(line)).toBe('vo-1:line-1');
  });

  it('preserves sign and remaining authority for positive and negative lines', () => {
    expect(validateVariationOrderDraftAmount(authority, 2500).valid).toBe(true);
    expect(validateVariationOrderDraftAmount(authority, 2500.01).valid).toBe(false);
    expect(validateVariationOrderDraftAmount(authority, -1).valid).toBe(false);
    expect(validateVariationOrderDraftAmount({ ...authority, issuedLineValue: -500, remainingCertifiableValue: -300 }, -300).valid).toBe(true);
    expect(validateVariationOrderDraftAmount({ ...authority, issuedLineValue: -500, remainingCertifiableValue: -300 }, 100).valid).toBe(false);
  });

  it('rejects fully certified and over-certified/non-eligible authority', () => {
    expect(validateVariationOrderDraftAmount({ ...authority, eligible: false, exception: 'Historically over-certified.' }, 1)).toEqual({ valid: false, errors: ['Historically over-certified.'] });
  });
});
