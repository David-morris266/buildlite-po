import { describe, expect, it } from 'vitest';
import { selectPaymentCertificateTerms } from './paymentCertificateTermsPresentation';

const live = { state: 'common', source: 'tenant_default', version: { familyName: 'Standard Subcontract Terms', versionLabel: 'Standard 2026', revisionNumber: 1 } };
const snap = (revisionNumber, capturedAt) => ({ state: 'common', readiness: 'configured', familyName: 'Standard Subcontract Terms', versionLabel: `Standard R${revisionNumber}`, revisionNumber, source: 'tenant_default', capturedAt });

describe('certificate terms presentation', () => {
  it('uses live Draft authority without a capture timestamp', () => {
    expect(selectPaymentCertificateTerms({ status: 'draft' }, live)).toMatchObject({ stateLabel: 'Live Draft authority', revisionNumber: 1, capturedAt: null });
  });

  it('uses the submission snapshot when Submitted', () => {
    expect(selectPaymentCertificateTerms({ status: 'submitted', submissionGoverningTermsSnapshot: snap(1, '2026-08-30T15:30:00Z') }, live)).toMatchObject({ stateLabel: 'Submitted snapshot', revisionNumber: 1, capturedAt: '2026-08-30T15:30:00Z' });
  });

  it('ignores a stale submission snapshot after rejection returns to Draft', () => {
    expect(selectPaymentCertificateTerms({ status: 'draft', submissionGoverningTermsSnapshot: snap(9, '2026-08-30T15:30:00Z') }, live)).toMatchObject({ stateLabel: 'Live Draft authority', revisionNumber: 1, capturedAt: null });
  });

  it('uses a refreshed submission snapshot on resubmission', () => {
    expect(selectPaymentCertificateTerms({ status: 'submitted', submissionGoverningTermsSnapshot: snap(2, '2026-08-30T16:45:00Z') }, live)).toMatchObject({ stateLabel: 'Submitted snapshot', revisionNumber: 2 });
  });

  it('uses the locked snapshot rather than live or submitted authority', () => {
    expect(selectPaymentCertificateTerms({ status: 'locked', submissionGoverningTermsSnapshot: snap(2), lockedGoverningTermsSnapshot: snap(1, '2026-08-30T17:00:00Z') }, { ...live, version: { ...live.version, revisionNumber: 3 } })).toMatchObject({ stateLabel: 'Locked snapshot', revisionNumber: 1 });
  });

  it('represents legacy and unavailable frozen terms neutrally', () => {
    expect(selectPaymentCertificateTerms({ status: 'draft' }, { state: 'legacy' })).toMatchObject({ available: false, message: 'Legacy / not formally configured' });
    expect(selectPaymentCertificateTerms({ status: 'submitted' }, live)).toMatchObject({ available: false, message: 'Contract terms unavailable' });
  });
});
