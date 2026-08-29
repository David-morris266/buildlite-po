const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDraftPatchBody, validateLinesAgainstEvents } = require('../services/paymentCertificateValidation');
const { buildCertificateWorksTotals, calculateRetentionMovement } = require('../services/paymentCertificateFinancials');

function voLine(overrides = {}) {
  return {
    id: 'cert-line-1', lineType: 'valueInclusion', sourceType: 'variationOrder',
    variationOrderId: 'vo-1', variationOrderLineId: 'vol-1',
    sourceReference: 'PO-1/VO-0001', sourcePoNumber: 'PO-1', sourceCostCode: '5218',
    description: 'Issued scope', sourceValue: 4500, sourcePreviouslyCertified: 2000,
    sourceRemainingAtAdd: 2500, amountThisCertificate: 1000, ...overrides,
  };
}

function authority(overrides = {}) {
  return {
    id: 'vo-1', status: 'issued', packageId: 'pkg-1', orderKey: 'order-1',
    displayReference: 'PO-1/VO-0001', sourcePoNumber: 'PO-1',
    lines: [{ id: 'vol-1', costCode: '5218', description: 'Issued scope', netValue: 4500, historicCertifiedValue: 2000, subsequentVoCertifiedValue: 0, remainingCertifiableValue: 2500, authorityAllocations: [] }],
    sourceCertificationExceptions: [], ...overrides,
  };
}

function validate(lines, vo = authority()) {
  return validateLinesAgainstEvents({ lines, eventsById: new Map(), variationOrdersById: new Map([[vo.id, vo]]), packageId: 'pkg-1', orderKey: 'order-1', lockedCertificates: [] });
}

test('VO JSONB valueInclusion contract preserves discriminated immutable provenance without commercialEventId', () => {
  const parsed = validateDraftPatchBody({ commercialLines: [voLine()] });
  assert.equal(parsed.ok, true, parsed.errors.join(' '));
  assert.deepEqual(parsed.commercialLines[0], {
    ...parsed.commercialLines[0],
    sourceType: 'variationOrder', variationOrderId: 'vo-1', variationOrderLineId: 'vol-1',
    sourceReference: 'PO-1/VO-0001', sourcePoNumber: 'PO-1', sourceCostCode: '5218', sourceValue: 4500,
  });
  assert.equal(parsed.commercialLines[0].commercialEventId, '');
});

test('only matching Issued VO-line authority validates, with sign, remaining and duplicate guards', () => {
  assert.equal(validate([voLine()]).ok, true);
  assert.match(validate([voLine()], authority({ status: 'approved' })).errors.join(' '), /not valid Issued authority/i);
  assert.match(validate([voLine({ amountThisCertificate: -100 })]).errors.join(' '), /preserve.*sign/i);
  assert.match(validate([voLine({ amountThisCertificate: 2500.01 })]).errors.join(' '), /remaining VO-line authority/i);
  assert.match(validate([voLine(), voLine({ id: 'two' })]).errors.join(' '), /appears more than once/i);
  assert.match(validate([voLine()], authority({ packageId: 'other' })).errors.join(' '), /does not belong/i);
  assert.match(validate([voLine({ sourceValue: 4600 })]).errors.join(' '), /has changed/i);
  assert.match(validate([voLine({ description: 'Forged' })]).errors.join(' '), /frozen description/i);
});

test('fully certified and over-certified VO lines are rejected while independent multi-lines validate', () => {
  const full = authority({ lines: [{ ...authority().lines[0], remainingCertifiableValue: 0 }] });
  assert.match(validate([voLine()], full).errors.join(' '), /no certifiable authority/i);
  const over = authority({
    lines: [{ ...authority().lines[0], authorityAllocations: [{ commercialEventId: 'ce-1' }] }],
    sourceCertificationExceptions: [{ commercialEventId: 'ce-1', overCertifiedAmount: 500 }],
  });
  assert.match(validate([voLine()], over).errors.join(' '), /no certifiable authority/i);
  const multi = authority({ lines: [
    authority().lines[0],
    { id: 'vol-2', costCode: '5219', description: 'Second scope', netValue: 800, remainingCertifiableValue: 800, authorityAllocations: [] },
  ] });
  const second = voLine({ id: 'second', variationOrderLineId: 'vol-2', sourceCostCode: '5219', description: 'Second scope', sourceValue: 800, sourcePreviouslyCertified: 0, sourceRemainingAtAdd: 800, amountThisCertificate: 400 });
  assert.equal(validate([voLine(), second], multi).ok, true);
});

test('negative VO inclusion uses normal gross/retention/VAT path and cumulative-gross safety', () => {
  const totals = buildCertificateWorksTotals([], {
    commercialLines: [voLine({ sourceValue: -1500, amountThisCertificate: -1500 })],
    previousGross: 36000, previousRetentionHeld: 1800, priorRates: [0.05], retentionRate: 0.05, vatRate: 0.2,
  });
  assert.equal(totals.grossWorksThisCertificate, -1500);
  assert.equal(totals.retention, -75);
  assert.equal(totals.vat, -285);
  assert.equal(totals.netPayment, -1710);
  assert.equal(calculateRetentionMovement({ currentGross: -1001, previousGross: 1000, previousRetentionHeld: 50, retentionRate: 0.05 }).ok, false);
});

test('legacy CE valueInclusion and recovery financial behaviour remain compatible', () => {
  const ce = { id: 'ce-line', commercialEventId: 'ce-1', lineType: 'valueInclusion', amountThisCertificate: 500, sourceEventNumber: 'CE-1', sourceEventType: 'variation', description: 'Legacy', sourceEventValue: 500 };
  const event = { id: 'ce-1', status: 'approved', eventType: 'variation', value: 500, packageUuid: 'pkg-1', orderKey: 'order-1' };
  assert.equal(validateLinesAgainstEvents({ lines: [ce], eventsById: new Map([['ce-1', event]]), packageId: 'pkg-1', orderKey: 'order-1', lockedCertificates: [] }).ok, true);
  const totals = buildCertificateWorksTotals([], { commercialLines: [ce, { lineType: 'recoveryDeduction', amountThisCertificate: -100 }], retentionRate: 0.05, vatRate: 0.2 });
  assert.equal(totals.grossWorksThisCertificate, 500);
  assert.equal(totals.recoveryDeductionSigned, -100);
});
