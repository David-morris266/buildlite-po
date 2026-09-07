/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PaymentCertificateLockedRecord from './PaymentCertificateLockedRecord';

const totals = { matrixGrossThisCertificate: 9834, commercialEventGrossThisCertificate: 5000, grossWorksThisCertificate: 14834, retention: 741.7, recoveryDeductionSigned: 0, vat: 2818.46, netPayment: 16910.76, retentionRate: 0.05, vatRate: 0.2, previousCertified: 30000, certifiedToDate: 44834, currentContractValue: 118000, remainingContract: 73166 };
const locked = {
  id: 'cert-2', status: 'locked', approvedBy: 'David Morris', approvedAt: '2026-09-07T09:18:00.000Z',
  lockedApplicationSnapshot: { application: { applicationReference: 'APP-HG-002', receivedAt: '2026-09-05' }, comparison: { comparable: true, applicationCurrentGross: 10000, assessmentCurrentGross: 14834, difference: 4834 } },
  paymentTimetable: { readiness: 'review_required', reasons: ['Governing payment-rule authority requires review.'] },
  sourceAuthority: { variationAssessmentGross: 5000, unapprovedCertifiedGross: 0, evidence: { variationAssessments: [{ id: 'a1', variationReference: 'VA-0001', description: 'Revised valley detail', signedAmount: 5000, unapprovedAmount: 0, authorityClassification: { effectiveRecognisedAuthority: 7000, supportingSources: [{ allocationId: 'ce1', sourceReference: 'CE-HG009', appliedAmount: 5000 }] } }] } },
};

describe('PaymentCertificateLockedRecord', () => {
  let host;
  let root;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  function render() {
    act(() => root.render(<PaymentCertificateLockedRecord certificate={locked} totals={totals} applicationComparison={locked.lockedApplicationSnapshot.comparison} supportingDetail={<div>Frozen valuation matrix and complete authority envelope £7,000.00</div>} noticeAndDocuments={<div>Payment Notices Commercial Documents</div>} />));
  }

  it('renders frozen lifecycle, commercial position, assessment and payment facts', () => {
    render(); const text = host.textContent;
    for (const expected of ['Approved & Locked', 'Approved commercial record. Certificate values are permanently locked.', 'Approved and locked by David Morris', 'Contractor Application£10,000.00', 'Certified Assessment£14,834.00', 'Difference+£4,834.00', 'Ordered Works£9,834.00', 'Variation assessments+£5,000.00', 'Retention (5%)−£741.70', 'VAT (20%)£2,818.46', 'Net Payment£16,910.76']) expect(text).toContain(expected);
    expect(text).not.toContain('Assessment differs from application');
  });

  it('uses frozen applied support, not the complete authority envelope', () => {
    render(); const primary = host.querySelector('.po-cert-locked__sections');
    for (const expected of ['VA-0001 — Revised valley detail', 'This certificate£5,000.00', 'Supported byCE-HG009 £5,000.00', 'Unapproved certified gross£0.00']) expect(primary.textContent).toContain(expected);
    expect(primary.textContent).not.toContain('£7,000.00');
    expect(host.querySelector('details').textContent).toContain('complete authority envelope £7,000.00');
  });

  it('shows only the frozen certificate position and collapses supporting evidence', () => {
    render(); const text = host.textContent;
    for (const expected of ['Previous certified£30,000.00', 'This certificate£14,834.00', 'Certified to date£44,834.00']) expect(text).toContain(expected);
    expect(text).not.toContain('Current Contract'); expect(text).not.toContain('Remaining Contract');
    expect(host.querySelector('details').open).toBe(false); expect(host.querySelector('details summary').textContent).toBe('View supporting detail');
  });

  it('keeps timetable exceptions concise and post-Lock workflows distinct', () => {
    render();
    expect(host.querySelector('.po-cert-locked__exceptions').textContent).toContain('Governing payment-rule authority requires review.');
    expect(host.querySelector('.po-cert-locked__post-lock').textContent).toContain('Notice & documents');
    expect(host.querySelector('.po-cert-locked__post-lock').textContent).toContain('Payment Notices Commercial Documents');
  });
});
