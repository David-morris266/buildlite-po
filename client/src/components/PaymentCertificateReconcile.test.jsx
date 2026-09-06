/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PaymentCertificateReconcile from './PaymentCertificateReconcile';

const totals = {
  matrixGrossThisCertificate: 7524,
  commercialEventGrossThisCertificate: 4000,
  grossWorksThisCertificate: 11524,
  retention: 576.2,
  recoveryDeductionSigned: 0,
  vat: 2189.56,
  netPayment: 13137.36,
  previousCertified: 8000,
  certifiedToDate: 19524,
  currentContractValue: 30000,
  remainingContract: 10476,
  retentionRate: 0.05,
  vatRate: 0.2,
};

const certificate = {
  sourceAuthority: {
    variationAssessmentGross: 4000,
    unapprovedCertifiedGross: 0,
    evidence: {
      variationAssessments: [{ signedAmount: 4000, priorAuthority: 7000, unapprovedAmount: 0 }],
    },
  },
  paymentTimetable: {
    readiness: 'ready',
    dates: { dueDate: '2026-09-08', payLessNoticeDeadline: '2026-09-29' },
  },
};

const comparison = {
  comparable: true,
  applicationCurrentGross: 10000,
  assessmentCurrentGross: 11524,
  difference: 1524,
};

describe('PaymentCertificateReconcile', () => {
  let host;
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    host?.remove();
    root = null;
  });

  function render(props = {}) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const onEditStage = vi.fn();
    act(() => root.render(<PaymentCertificateReconcile certificate={certificate} totals={totals} applicationComparison={comparison} onEditStage={onEditStage} {...props} />));
    return { host, onEditStage };
  }

  it('uses authoritative application, certificate and source-authority facts', () => {
    const { host: node } = render();
    const text = node.textContent;
    expect(text).toContain('Contractor application£10,000.00');
    expect(text).toContain('BuildLite assessment£11,524.00');
    expect(text).toContain('Difference+£1,524.00');
    expect(text).toContain('Ordered Works£7,524.00');
    expect(text).toContain('Variation assessments+£4,000.00');
    expect(text).toContain('Gross assessment£11,524.00');
    expect(text).toContain('Retention (5%)−£576.20');
    expect(text).toContain('Recoveries£0.00');
    expect(text).toContain('VAT (20%)£2,189.56');
    expect(text).toContain('Net payment£13,137.36');
    expect(text).toContain('Previous certified£8,000.00');
    expect(text).toContain('Certified to date£19,524.00');
    expect(text).toContain('Current Contract£30,000.00');
    expect(text).toContain('Remaining Contract£10,476.00');
    expect(text).toContain('Assessment supported by prior commercial authority£4,000.00');
    expect(text).not.toContain('£7,000.00');
    expect(text).not.toContain('has no prior commercial authority');
  });

  it('shows only the exact-pence residual commercial assessment and does not double count gross', () => {
    const { host: node } = render({ totals: { ...totals, commercialEventGrossThisCertificate: 4250.01, grossWorksThisCertificate: 11774.01 } });
    expect(node.textContent).toContain('Other assessed commercial items+£250.01');
    expect(node.textContent.match(/Gross assessment£11,774.01/g)).toHaveLength(1);
  });

  it('preserves signed difference, recovery and retention-release presentation', () => {
    const { host: node } = render({
      totals: { ...totals, retention: -100, recoveryDeductionSigned: -240 },
      applicationComparison: { ...comparison, difference: -1524 },
    });
    expect(node.textContent).toContain('Difference−£1,524.00');
    expect(node.textContent).toContain('Retention (5%)+£100.00');
    expect(node.textContent).toContain('Recoveries−£240.00');
  });

  it('shows unapproved authority as a QS-facing warning but makes no Pay Less decision', () => {
    const { host: node } = render({ certificate: { ...certificate, sourceAuthority: { ...certificate.sourceAuthority, unapprovedCertifiedGross: 200 } } });
    expect(node.textContent).toContain('£200.00 of this assessment has no prior commercial authority. Review before submitting.');
    expect(node.textContent).toContain('Notice and Pay Less requirements will be confirmed');
    expect(node.textContent).not.toContain('Pay Less required');
    expect(node.textContent).toContain('Due date8 Sept 2026');
    expect(node.textContent).toContain('Pay Less deadline29 Sept 2026');
  });

  it('treats a missing comparable application as advisory readiness and offers local edit-back actions', () => {
    const { host: node, onEditStage } = render({ applicationComparison: null });
    expect(node.textContent).toContain('Resolve before release: no comparable contractor application');
    const click = (label) => act(() => [...node.querySelectorAll('button')].find((button) => button.textContent === label).click());
    click('Edit Application');
    click('Edit Ordered Works');
    click('Edit Variations');
    expect(onEditStage.mock.calls.map(([stage]) => stage)).toEqual(['application', 'ordered-works', 'variations']);
  });
});
