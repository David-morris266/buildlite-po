/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentCertificateApprovalReview from './PaymentCertificateApprovalReview';

let permissions = ['certificate.lock'];
vi.mock('../auth/BuildLiteAuthProvider', () => ({
  useBuildLitePermission: (permission) => permissions.includes(permission),
}));

const totals = {
  matrixGrossThisCertificate: 9834,
  commercialEventGrossThisCertificate: 5000,
  grossWorksThisCertificate: 14834,
  retention: 741.7,
  recoveryDeductionSigned: 0,
  vat: 2818.46,
  netPayment: 16910.76,
  retentionRate: 0.05,
  vatRate: 0.2,
  previousCertified: 30000,
  certifiedToDate: 44834,
  currentContractValue: 118000,
  remainingContract: 73166,
  retentionErrors: [],
};

const applicationComparison = {
  comparable: true,
  applicationCurrentGross: 10000,
  assessmentCurrentGross: 14834,
  difference: 4834,
};

function certificate(overrides = {}) {
  return {
    id: 'cert-2',
    status: 'submitted',
    submittedBy: 'David Morris',
    submittedAt: '2026-09-06T20:08:26.288Z',
    submissionApplicationSnapshot: { application: { applicationReference: 'ABC', receivedAt: '2026-09-05' } },
    paymentTimetable: { readiness: 'review_required', reasons: ['Governing payment-rule authority requires review.'], dates: null },
    sourceAuthority: {
      orderedWorkBackedGross: 9834,
      orderedWorkExcessGross: 0,
      approvedPoAuthority: 110000,
      variationAssessmentGross: 5000,
      unapprovedCertifiedGross: 0,
      evidence: { variationAssessments: [{
        id: 'a1', variationReference: 'VA-0001', description: 'Revised valley detail',
        signedAmount: 5000, unapprovedAmount: 0,
        authorityClassification: {
          effectiveRecognisedAuthority: 7000,
          supportingSources: [{ allocationId: 'ce1', sourceReference: 'CE-HG009', appliedAmount: 5000 }],
        },
      }] },
    },
    ...overrides,
  };
}

describe('PaymentCertificateApprovalReview', () => {
  let host;
  let root;
  beforeEach(() => {
    permissions = ['certificate.lock'];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(props = {}) {
    act(() => root.render(<PaymentCertificateApprovalReview certificate={certificate()} totals={totals} applicationComparison={applicationComparison} onApprove={vi.fn()} onReturnToDraft={vi.fn()} valuationDetail={<div>Submitted matrix evidence</div>} {...props} />));
  }

  it('shows the concise submitted decision facts and neutral difference', () => {
    render();
    expect(host.textContent).toContain('Submitted for Approval');
    expect(host.textContent).toContain('Submitted by David Morris');
    expect(host.textContent).toContain('Contractor Application£10,000.00');
    expect(host.textContent).toContain('BuildLite Assessment£14,834.00');
    expect(host.textContent).toContain('Difference+£4,834.00');
    expect(host.textContent).toContain('Net Payment£16,910.76');
    expect(host.textContent).toContain('Ordered Works£9,834.00');
    expect(host.textContent).toContain('Variation assessments+£5,000.00');
    expect(host.textContent).not.toContain('Other assessed commercial items');
    expect(host.textContent).toContain('BuildLite Assessment is £4,834.00 above');
    expect(host.querySelector('.po-cert-submit__difference').className).not.toContain('warning');
  });

  it('uses applied assessment support rather than the full authority envelope', () => {
    render();
    const items = host.querySelector('[aria-label="Commercial items in this certificate"]');
    expect(items.textContent).toContain('VA-0001 — Revised valley detail');
    expect(items.textContent).toContain('This certificate£5,000.00');
    expect(items.textContent).toContain('Supported byCE-HG009 £5,000.00');
    expect(items.textContent).toContain('Supported');
    expect(items.textContent).not.toContain('£7,000.00');
    expect(host.textContent).toContain('Current variation assessment£5,000.00');
    expect(host.textContent).toContain('Supported by prior commercial authority£5,000.00');
    expect(host.textContent).toContain('This assessment contains no unapproved certified gross.');
    expect(host.textContent).toContain('authority envelope £7,000.00');
  });

  it('renders multiple assessed items independently and gives partial support genuine warning treatment', () => {
    const sourceAuthority = {
      ...certificate().sourceAuthority,
      unapprovedCertifiedGross: 2000,
      evidence: { variationAssessments: [
        certificate().sourceAuthority.evidence.variationAssessments[0],
        {
          id: 'a2', variationReference: 'VA-0002', description: 'Additional roof works',
          signedAmount: 5000, unapprovedAmount: 2000,
          authorityClassification: {
            effectiveRecognisedAuthority: 9000,
            supportingSources: [
              { allocationId: 'ce2', sourceReference: 'CE-HG010', appliedAmount: 1000 },
              { allocationId: 'vo1', sourceReference: 'VO-004', appliedAmount: 2000 },
            ],
          },
        },
      ] },
    };
    render({ certificate: certificate({ sourceAuthority }) });
    const cards = [...host.querySelectorAll('.po-cert-approval__authority-item')];
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('CE-HG009 £5,000.00');
    expect(cards[1].textContent).toContain('VA-0002 — Additional roof works');
    expect(cards[1].textContent).toContain('CE-HG010 £1,000.00');
    expect(cards[1].textContent).toContain('VO-004 £2,000.00');
    expect(cards[1].textContent).toContain('Unapproved£2,000.00');
    expect(cards[1].textContent).toContain('Partly supported');
    expect(cards[1].classList.contains('po-cert-approval__authority-item--warning')).toBe(true);
  });

  it('does not render an empty commercial-item list when no variation assessment evidence applies', () => {
    render({ certificate: certificate({ sourceAuthority: { ...certificate().sourceAuthority, variationAssessmentGross: 0, evidence: { variationAssessments: [] } } }) });
    expect(host.querySelector('[aria-label="Commercial items in this certificate"]')).toBeNull();
  });

  it('shows genuine unapproved and timetable exceptions without inventing dates', () => {
    render({ certificate: certificate({ sourceAuthority: { ...certificate().sourceAuthority, unapprovedCertifiedGross: 200, evidence: { variationAssessments: [{ id: 'a1', signedAmount: 5000, unapprovedAmount: 200 }] } } }) });
    expect(host.textContent).toContain('£200.00 of this assessment has no prior commercial authority. Review before approving.');
    expect(host.textContent).toContain('Governing payment-rule authority requires review.');
    expect(host.textContent).not.toContain('Due date');
  });

  it('keeps supporting evidence collapsed until deliberately opened', () => {
    render();
    const detail = host.querySelector('details');
    expect(detail.open).toBe(false);
    expect(detail.querySelector('summary').textContent).toBe('View supporting detail');
    expect(detail.textContent).toContain('Submitted matrix evidence');
    expect(detail.textContent).toContain('authority envelope £7,000.00');
  });

  it('removes the duplicate standalone approval and retains permission-controlled Return to Draft', () => {
    const onReturnToDraft = vi.fn();
    render({ onReturnToDraft });
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.some((button) => button.textContent === 'Approve & Lock')).toBe(false);
    expect(host.textContent).toContain('Use the Payment Approval worklist');
    act(() => buttons.find((button) => button.textContent === 'Return to Draft').click());
    expect(onReturnToDraft).toHaveBeenCalledOnce();

    permissions = [];
    render({ onReturnToDraft });
    expect([...host.querySelectorAll('button')].some((button) => button.textContent === 'Approve & Lock')).toBe(false);
    expect([...host.querySelectorAll('button')].some((button) => button.textContent === 'Return to Draft')).toBe(false);
    expect(host.textContent).toContain('You do not have permission');
  });
});
