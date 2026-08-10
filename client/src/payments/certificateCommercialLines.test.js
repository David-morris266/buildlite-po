import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { saveCompanySettings } from '../admin/companyStore';
import {
  approveCommercialEvent,
  clearCommercialEventsStore,
  createCommercialEvent,
  createLinkedRecoveryFromOrigin,
  getCommercialEventById,
  submitCommercialEvent,
} from '../commercialEvents/commercialEventStore';
import {
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_TYPES,
} from '../commercialEvents/commercialEventTypes';
import { isCommercialEventCertifiable } from '../commercialEvents/commercialEventCertifiability';
import { buildPackageCommercialDisplayFields } from '../commercialEvents/commercialEventPackageValue';
import {
  addCommercialLineToCertificate,
  approveCertificate,
  createCertificate,
  getCertificate,
  normalizeCertificate,
  rejectCertificate,
  removeCommercialLineFromCertificate,
  submitCertificate,
  updateCommercialLineAmount,
  updateCertificateCommercialLines,
} from './paymentCertificateStore';
import {
  buildCertificateCommercialLineRows,
  buildSelectedCommercialEventPreview,
  calculateCommercialEventCertifiedToDate,
  calculateCommercialEventRemaining,
  formatEligibleCommercialEventOptionLabel,
  formatSignedCommercialEventAmount,
  getCommercialEventApprovedValueLabel,
  getMaxAmountThisCertificate,
  listEligibleCommercialEvents,
  normalizeCommercialLines,
  sumCommercialLinesThisCertificate,
  validateCommercialLineAmount,
  validateCommercialLinesForCertificate,
} from './certificateCommercialLines';
import { buildCertificateCommercialTotals, buildCertificateWorksTotals } from './paymentCertificateProgress';
import { ensurePackageRecord } from './subcontractPackageStore';

const DEV_ID = 'dev-001';
const ORDER_KEY = 'dev-001::sup-1::0120';

const baseOrder = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  supplierId: 'sup-1',
  costCode: '0120',
  supplierLabel: 'PlumbCo',
  committedValue: 12000,
  poNumbers: ['S0004'],
  pos: [],
};

function seedApprovedEvent(overrides = {}) {
  const created = createCommercialEvent(DEV_ID, {
    packageId: ORDER_KEY,
    poNumber: 'S0004',
    supplierId: 'sup-1',
    costCode: '0120',
    eventType: COMMERCIAL_EVENT_TYPES.variation.key,
    category: 'commercial',
    subcategory: 'scopeChange',
    responsibility: 'commercial',
    description: 'Scope change',
    value: 10000,
    ...overrides,
  });
  submitCommercialEvent(DEV_ID, created.event.id);
  approveCommercialEvent(DEV_ID, created.event.id);
  return created.event;
}

function createDraftCertificate() {
  const result = createCertificate(ORDER_KEY, baseOrder);
  expect(result.ok).toBe(true);
  return result.certificate;
}

describe('certificateCommercialLines BL-025.2', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
    ensurePackageRecord(ORDER_KEY, baseOrder);
  });

  it('1. legacy certificate normalizes commercialLines to []', () => {
    const legacy = normalizeCertificate({ id: 'cert-legacy', status: 'draft' });
    expect(legacy.commercialLines).toEqual([]);
  });

  it('2. approved certifiable CE appears as eligible', () => {
    const event = seedApprovedEvent();
    const certificate = createDraftCertificate();
    const eligible = listEligibleCommercialEvents(DEV_ID, ORDER_KEY, certificate);
    expect(eligible.some((item) => item.id === event.id)).toBe(true);
  });

  it('3. draft CE excluded from eligibility', () => {
    createCommercialEvent(DEV_ID, {
      packageId: ORDER_KEY,
      poNumber: 'S0004',
      supplierId: 'sup-1',
      costCode: '0120',
      eventType: COMMERCIAL_EVENT_TYPES.variation.key,
      category: 'commercial',
      subcategory: 'scopeChange',
      responsibility: 'commercial',
      description: 'Draft only',
      value: 1000,
    });
    const certificate = createDraftCertificate();
    expect(listEligibleCommercialEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(0);
  });

  it('4. submitted CE excluded from eligibility', () => {
    const created = createCommercialEvent(DEV_ID, {
      packageId: ORDER_KEY,
      poNumber: 'S0004',
      supplierId: 'sup-1',
      costCode: '0120',
      eventType: COMMERCIAL_EVENT_TYPES.variation.key,
      category: 'commercial',
      subcategory: 'scopeChange',
      responsibility: 'commercial',
      description: 'Submitted only',
      value: 1000,
    });
    submitCommercialEvent(DEV_ID, created.event.id);
    const certificate = createDraftCertificate();
    expect(listEligibleCommercialEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(0);
  });

  it('5. budget transfer excluded from eligibility', () => {
    seedApprovedEvent({
      eventType: COMMERCIAL_EVENT_TYPES.budgetTransfer.key,
      category: 'budget',
      subcategory: 'budgetTransfer',
      description: 'Budget transfer',
    });
    const certificate = createDraftCertificate();
    expect(listEligibleCommercialEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(0);
  });

  it('6. recovery event excluded from eligibility', () => {
    seedApprovedEvent({
      eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
      category: 'recovery',
      subcategory: 'contraCharge',
      description: 'Recovery event',
      value: -1000,
      relationshipType: COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key,
    });
    const certificate = createDraftCertificate();
    expect(listEligibleCommercialEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(0);
  });

  it('7. same-package enforcement on add', () => {
    const event = seedApprovedEvent({ packageId: 'dev-001::sup-9::0999' });
    const certificate = createDraftCertificate();
    const result = addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      event.id,
      1000,
      baseOrder
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/package/i);
  });

  it('8. add CE line to draft certificate', () => {
    const event = seedApprovedEvent();
    const certificate = createDraftCertificate();
    const result = addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      event.id,
      4000,
      baseOrder
    );
    expect(result.ok).toBe(true);
    const saved = getCertificate(ORDER_KEY, certificate.id);
    expect(saved.commercialLines).toHaveLength(1);
    expect(saved.commercialLines[0].commercialEventId).toBe(event.id);
    expect(saved.commercialLines[0].amountThisCertificate).toBe(4000);
    expect(saved.commercialLines[0].sourceEventNumber).toBe(event.eventNumber);
  });

  it('9. duplicate CE line blocked', () => {
    const event = seedApprovedEvent();
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 1000, baseOrder);
    const duplicate = addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      event.id,
      500,
      baseOrder
    );
    expect(duplicate.ok).toBe(false);
    expect(duplicate.errors.join(' ')).toMatch(/already included/i);
  });

  it('10. edit commercial line amount', () => {
    const event = seedApprovedEvent();
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 1000, baseOrder);
    const lineId = getCertificate(ORDER_KEY, certificate.id).commercialLines[0].id;
    const result = updateCommercialLineAmount(
      ORDER_KEY,
      certificate.id,
      lineId,
      2500,
      baseOrder
    );
    expect(result.ok).toBe(true);
    expect(
      getCertificate(ORDER_KEY, certificate.id).commercialLines[0].amountThisCertificate
    ).toBe(2500);
  });

  it('11. remove commercial line from draft', () => {
    const event = seedApprovedEvent();
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 1000, baseOrder);
    const lineId = getCertificate(ORDER_KEY, certificate.id).commercialLines[0].id;
    const result = removeCommercialLineFromCertificate(
      ORDER_KEY,
      certificate.id,
      lineId,
      baseOrder
    );
    expect(result.ok).toBe(true);
    expect(getCertificate(ORDER_KEY, certificate.id).commercialLines).toHaveLength(0);
  });

  it('12. submitted certificate commercial lines are read-only via store guard', () => {
    const event = seedApprovedEvent();
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 1000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    const result = addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      event.id,
      500,
      baseOrder
    );
    expect(result.ok).toBe(false);
  });

  it('13. locked certificate commercial lines are read-only via store guard', () => {
    const event = seedApprovedEvent();
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 1000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, { grossThisCertificate: 1000, netPayment: 1140 });
    const result = updateCertificateCommercialLines(
      ORDER_KEY,
      certificate.id,
      [{ id: 'x', commercialEventId: event.id, amountThisCertificate: 2000 }],
      baseOrder
    );
    expect(result.ok).toBe(false);
  });

  it('14. rejected certificate returns to editable draft lines', () => {
    const event = seedApprovedEvent();
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 1000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    rejectCertificate(ORDER_KEY, certificate.id, 'Adjust commercial lines');
    const result = updateCommercialLineAmount(
      ORDER_KEY,
      certificate.id,
      getCertificate(ORDER_KEY, certificate.id).commercialLines[0].id,
      1500,
      baseOrder
    );
    expect(result.ok).toBe(true);
  });

  it('15. previously certified derived from approved/locked certificate lines only', () => {
    const event = seedApprovedEvent({ value: 10000 });
    const cert1 = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, cert1.id, event.id, 4000, baseOrder);
    submitCertificate(ORDER_KEY, cert1.id);
    approveCertificate(ORDER_KEY, cert1.id, { grossThisCertificate: 4000, netPayment: 4560 });

    const cert2 = createDraftCertificate();
    expect(calculateCommercialEventCertifiedToDate(ORDER_KEY, event.id)).toBe(4000);
    expect(
      calculateCommercialEventCertifiedToDate(ORDER_KEY, event.id, {
        excludeCertificateId: cert2.id,
      })
    ).toBe(4000);
  });

  it('16. draft certificate lines do not count as previously certified', () => {
    const event = seedApprovedEvent({ value: 10000 });
    const cert1 = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, cert1.id, event.id, 4000, baseOrder);
    expect(calculateCommercialEventCertifiedToDate(ORDER_KEY, event.id)).toBe(0);
  });

  it('17. positive CE remaining calculation', () => {
    expect(calculateCommercialEventRemaining(10000, 4000, 2000)).toBe(4000);
    expect(getMaxAmountThisCertificate(10000, 4000)).toBe(6000);
  });

  it('18. negative credit signed remaining calculation', () => {
    expect(calculateCommercialEventRemaining(-5000, -2000, -1000)).toBe(-2000);
    expect(getMaxAmountThisCertificate(-5000, -2000)).toBe(-3000);
  });

  it('19. over-certification blocked', () => {
    const check = validateCommercialLineAmount(7000, 10000, 4000);
    expect(check.valid).toBe(false);
    const creditCheck = validateCommercialLineAmount(-4000, -5000, -2000);
    expect(creditCheck.valid).toBe(false);
  });

  it('20. stale CE validation blocked safely', () => {
    const event = seedApprovedEvent({ value: 10000 });
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 1000, baseOrder);
    const staleLine = {
      ...getCertificate(ORDER_KEY, certificate.id).commercialLines[0],
      sourceEventValue: 9000,
    };
    const validation = validateCommercialLinesForCertificate({
      orderKey: ORDER_KEY,
      certificateId: certificate.id,
      developmentId: DEV_ID,
      commercialLines: [staleLine],
    });
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toMatch(/changed/i);
  });

  it('21. stored snapshot fields retained on approved certificate', () => {
    const event = seedApprovedEvent({
      value: 10000,
      description: 'Electrical extras',
      eventType: COMMERCIAL_EVENT_TYPES.salesUpgrade.key,
      category: 'sales',
      subcategory: 'buyerUpgrade',
    });
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 4000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, { grossThisCertificate: 4000, netPayment: 4560 });
    const locked = getCertificate(ORDER_KEY, certificate.id);
    expect(locked.commercialLines[0].sourceEventNumber).toBe(event.eventNumber);
    expect(locked.commercialLines[0].description).toBe('Electrical extras');
    expect(locked.commercialLines[0].sourceEventValue).toBe(10000);
    expect(locked.commercialLines[0].amountThisCertificate).toBe(4000);
  });

  it('22. matrix valuation maths unchanged by commercial lines', () => {
    const cells = [
      {
        thisCertificateValue: 2500,
        previousValue: 1000,
        certifiedToDateValue: 3500,
      },
    ];
    const totals = buildCertificateCommercialTotals(cells, 12000);
    expect(totals.grossThisCertificate).toBe(2500);
    expect(totals.netPayment).toBeGreaterThan(0);
  });

  it('23. gross/retention/VAT/net unchanged when commercial lines exist on draft cert', () => {
    const event = seedApprovedEvent({ value: 5000, description: 'Second event' });
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      event.id,
      5000,
      baseOrder
    );
    const saved = getCertificate(ORDER_KEY, certificate.id);
    const matrixTotals = buildCertificateCommercialTotals(
      [{ thisCertificateValue: 1000, previousValue: 0, certifiedToDateValue: 1000 }],
      12000
    );
    const worksTotals = buildCertificateWorksTotals(
      [{ thisCertificateValue: 1000, previousValue: 0, certifiedToDateValue: 1000 }],
      {
        commercialLines: saved.commercialLines,
        currentContractValue: 125000,
        previousGrossWorks: 0,
      }
    );
    expect(matrixTotals.grossThisCertificate).toBe(1000);
    expect(worksTotals.grossWorksThisCertificate).toBe(6000);
  });

  it('24. no CE certificateStatus mutation when adding lines', () => {
    const event = seedApprovedEvent();
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 1000, baseOrder);
    expect(getCommercialEventById(DEV_ID, event.id).certificateStatus).toBe('notIncluded');
  });

  it('25. no recovery mutation when adding lines', () => {
    const event = seedApprovedEvent();
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 1000, baseOrder);
    expect(getCommercialEventById(DEV_ID, event.id).recoveredAmount).toBe(0);
  });

  it('26. current contract value unchanged from BL-025.1 when lines added', () => {
    const event = seedApprovedEvent({ value: 2000 });
    const before = buildPackageCommercialDisplayFields(baseOrder).currentPackageValue;
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 1000, baseOrder);
    const after = buildPackageCommercialDisplayFields(baseOrder).currentPackageValue;
    expect(after).toBe(before);
    expect(after).toBe(14000);
  });

  it('27. buildCertificateCommercialLineRows uses stored snapshot on locked certificate', () => {
    const event = seedApprovedEvent({ value: 10000, description: 'Frozen line' });
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 4000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, { grossThisCertificate: 4000, netPayment: 4560 });
    const locked = getCertificate(ORDER_KEY, certificate.id);
    const rows = buildCertificateCommercialLineRows(ORDER_KEY, locked, DEV_ID);
    expect(rows[0].description).toBe('Frozen line');
    expect(rows[0].amountThisCertificate).toBe(4000);
    expect(rows[0].previouslyCertified).toBe(0);
  });

  it('lists eligible events only for certifiable approved types', () => {
    expect(isCommercialEventCertifiable({ id: 'x', status: 'approved', eventType: 'variation' })).toBe(
      true
    );
    expect(
      isCommercialEventCertifiable({ id: 'x', status: 'approved', eventType: 'budgetTransfer' })
    ).toBe(false);
  });

  it('normalizes missing commercialLines arrays', () => {
    expect(normalizeCommercialLines(undefined)).toEqual([]);
  });
});

describe('BL-025.2 UAT potential contra origin certifiability', () => {
  const PACKAGE_B = 'dev-001::sup-2::0200';

  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
    ensurePackageRecord(ORDER_KEY, baseOrder);
  });

  function seedPotentialContraOrigin(overrides = {}) {
    return seedApprovedEvent({
      eventNumber: 'CE-0014',
      description: 'Repair damage',
      value: 7500,
      potentialContraCharge: true,
      potentialContraChargeNotes: 'Recover from brickwork',
      ...overrides,
    });
  }

  it('lists approved potential contra origin in eligible commercial events', () => {
    const event = seedPotentialContraOrigin();
    const certificate = createDraftCertificate();
    const eligible = listEligibleCommercialEvents(DEV_ID, ORDER_KEY, certificate);
    expect(eligible.some((item) => item.id === event.id)).toBe(true);
  });

  it('adds CE-0014-style origin to a draft certificate as valueInclusion', () => {
    const event = seedPotentialContraOrigin();
    const certificate = createDraftCertificate();
    const result = addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      event.id,
      2500,
      baseOrder
    );
    expect(result.ok).toBe(true);
    const saved = getCertificate(ORDER_KEY, certificate.id);
    expect(saved.commercialLines[0].amountThisCertificate).toBe(2500);
    expect(saved.commercialLines[0].sourceEventValue).toBe(7500);
  });

  it('keeps sales upgrade events certifiable without potential contra flag', () => {
    const event = seedApprovedEvent({
      eventNumber: 'CE-0013',
      eventType: COMMERCIAL_EVENT_TYPES.salesUpgrade.key,
      category: 'sales',
      subcategory: 'buyerUpgrade',
      description: 'Sales upgrade',
      value: 5000,
      potentialContraCharge: false,
    });
    const certificate = createDraftCertificate();
    expect(listEligibleCommercialEvents(DEV_ID, ORDER_KEY, certificate)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: event.id })])
    );
  });

  it('excludes linked recovery events on another package from origin eligibility', () => {
    const origin = seedPotentialContraOrigin();

    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    expect(linked.ok).toBe(true);

    const certificate = createDraftCertificate();
    const originEligible = listEligibleCommercialEvents(DEV_ID, ORDER_KEY, certificate);
    expect(originEligible.some((item) => item.id === origin.id)).toBe(true);

    const recoveryEligible = listEligibleCommercialEvents(DEV_ID, PACKAGE_B, certificate);
    expect(recoveryEligible.some((item) => item.id === linked.recovery.id)).toBe(false);
  });

  it('does not mutate CE lifecycle fields when adding certificate lines', () => {
    const event = seedPotentialContraOrigin();
    const before = getCommercialEventById(DEV_ID, event.id);
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 1000, baseOrder);
    const after = getCommercialEventById(DEV_ID, event.id);

    expect(after.potentialContraCharge).toBe(before.potentialContraCharge);
    expect(after.linkedEventId).toBe(before.linkedEventId);
    expect(after.relationshipType).toBe(before.relationshipType);
    expect(after.recoveryStatus).toBe(before.recoveryStatus);
    expect(after.recoveredAmount).toBe(before.recoveredAmount);
    expect(after.certificateStatus).toBe(before.certificateStatus);
    expect(after.status).toBe(before.status);
  });

  it('leaves package current contract value unchanged when cert line is added', () => {
    const event = seedPotentialContraOrigin();
    const before = buildPackageCommercialDisplayFields(baseOrder).currentPackageValue;
    const certificate = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, event.id, 2500, baseOrder);
    const after = buildPackageCommercialDisplayFields(baseOrder).currentPackageValue;
    expect(after).toBe(before);
    expect(after).toBe(19500);
  });
});

describe('certificate commercial event selector valuation context', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
    ensurePackageRecord(ORDER_KEY, baseOrder);
  });

  it('shows full approved value available on first certificate', () => {
    const event = seedApprovedEvent({
      description: 'Repair damage',
      value: 7500,
    });
    const liveEvent = getCommercialEventById(DEV_ID, event.id);
    const certificate = createDraftCertificate();
    const preview = buildSelectedCommercialEventPreview(
      liveEvent,
      ORDER_KEY,
      certificate.id
    );

    expect(preview.approvedValue).toBe(7500);
    expect(preview.previouslyCertified).toBe(0);
    expect(preview.availableThisCertificate).toBe(7500);
    expect(formatEligibleCommercialEventOptionLabel(liveEvent, ORDER_KEY, certificate.id)).toBe(
      `${liveEvent.eventNumber} — Repair damage — £7,500.00 remaining`
    );
  });

  it('shows partially certified positive CE remaining on subsequent certificate', () => {
    const event = seedApprovedEvent({
      description: 'Repair damage',
      value: 7500,
    });
    const cert1 = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, cert1.id, event.id, 4000, baseOrder);
    submitCertificate(ORDER_KEY, cert1.id);
    approveCertificate(ORDER_KEY, cert1.id, {
      grossThisCertificate: 4000,
      netPayment: 4560,
    });

    const cert2 = createDraftCertificate();
    const liveEvent = getCommercialEventById(DEV_ID, event.id);
    const preview = buildSelectedCommercialEventPreview(
      liveEvent,
      ORDER_KEY,
      cert2.id
    );

    expect(preview.previouslyCertified).toBe(4000);
    expect(preview.availableThisCertificate).toBe(3500);
    expect(formatEligibleCommercialEventOptionLabel(liveEvent, ORDER_KEY, cert2.id)).toBe(
      `${liveEvent.eventNumber} — Repair damage — £3,500.00 remaining`
    );
  });

  it('shows partially certified negative credit remaining correctly', () => {
    const event = seedApprovedEvent({
      eventType: COMMERCIAL_EVENT_TYPES.credit.key,
      category: 'commercial',
      subcategory: 'credit',
      description: 'Credit allowance',
      value: -5000,
    });
    const cert1 = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, cert1.id, event.id, -2000, baseOrder);
    submitCertificate(ORDER_KEY, cert1.id);
    approveCertificate(ORDER_KEY, cert1.id, {
      grossThisCertificate: -2000,
      netPayment: -2280,
    });

    const cert2 = createDraftCertificate();
    const liveEvent = getCommercialEventById(DEV_ID, event.id);
    const preview = buildSelectedCommercialEventPreview(
      liveEvent,
      ORDER_KEY,
      cert2.id
    );

    expect(getCommercialEventApprovedValueLabel(liveEvent)).toBe('Approved credit');
    expect(preview.approvedValueFormatted).toBe('-£5,000.00');
    expect(preview.previouslyCertifiedFormatted).toBe('-£2,000.00');
    expect(preview.availableThisCertificateFormatted).toBe('-£3,000.00');
    expect(formatSignedCommercialEventAmount(preview.availableThisCertificate)).toBe('-£3,000.00');
  });

  it('derives remaining from locked prior certificate only', () => {
    const event = seedApprovedEvent({ value: 10000 });
    const cert1 = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, cert1.id, event.id, 4000, baseOrder);
    submitCertificate(ORDER_KEY, cert1.id);
    approveCertificate(ORDER_KEY, cert1.id, {
      grossThisCertificate: 4000,
      netPayment: 4560,
    });

    const cert2 = createDraftCertificate();
    const liveEvent = getCommercialEventById(DEV_ID, event.id);
    const preview = buildSelectedCommercialEventPreview(
      liveEvent,
      ORDER_KEY,
      cert2.id
    );

    expect(calculateCommercialEventCertifiedToDate(ORDER_KEY, event.id)).toBe(4000);
    expect(preview.availableThisCertificate).toBe(6000);
    expect(listEligibleCommercialEvents(DEV_ID, ORDER_KEY, cert2)).toHaveLength(1);
  });

  it('keeps existing add edit and remove behaviour unchanged', () => {
    const event = seedApprovedEvent({ value: 10000 });
    const certificate = createDraftCertificate();
    const addResult = addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      event.id,
      2500,
      baseOrder
    );
    expect(addResult.ok).toBe(true);

    const lineId = getCertificate(ORDER_KEY, certificate.id).commercialLines[0].id;
    const editResult = updateCommercialLineAmount(
      ORDER_KEY,
      certificate.id,
      lineId,
      3000,
      baseOrder
    );
    expect(editResult.ok).toBe(true);

    const removeResult = removeCommercialLineFromCertificate(
      ORDER_KEY,
      certificate.id,
      lineId,
      baseOrder
    );
    expect(removeResult.ok).toBe(true);
    expect(getCertificate(ORDER_KEY, certificate.id).commercialLines).toHaveLength(0);
  });
});
