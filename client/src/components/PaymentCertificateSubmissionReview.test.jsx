/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PaymentCertificateSubmissionReview from './PaymentCertificateSubmissionReview';

const auth = { permissions: new Set(['certificate.submit']) };
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: (permission) => auth.permissions.has(permission) }));

const totals = { grossWorksThisCertificate: 11524, netPayment: 13137.36, retentionErrors: [] };
const comparison = { comparable: true, applicationCurrentGross: 10000, difference: 1524 };
const certificate = { sourceAuthority: { unapprovedCertifiedGross: 0, evidence: { variationAssessments: [{ signedAmount: 4000, priorAuthority: 7000, unapprovedAmount: 0 }] } }, paymentTimetable: { readiness: 'ready', dates: { dueDate: '2026-09-08', payLessNoticeDeadline: '2026-09-29' } } };

describe('PaymentCertificateSubmissionReview', () => {
  let host;
  let root;
  afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); root = null; auth.permissions = new Set(['certificate.submit']); });
  function render(props = {}) {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    const onSubmit = vi.fn(), onEditStage = vi.fn();
    act(() => root.render(<PaymentCertificateSubmissionReview certificate={certificate} totals={totals} applicationComparison={comparison} onSubmit={onSubmit} onEditStage={onEditStage} {...props} />));
    return { host, onSubmit, onEditStage };
  }
  it('renders authoritative final facts and a neutral variance', () => {
    const text = render().host.textContent;
    for (const value of ['Final review','Contractor Application£10,000.00','BuildLite Assessment£11,524.00','Difference+£1,524.00','Net Payment£13,137.36','BuildLite Assessment is £1,524.00 above','Assessment supported by prior commercial authority£4,000.00','Unapproved certified gross£0.00','Due date8 Sept 2026','Pay Less deadline29 Sept 2026']) expect(text).toContain(value);
    expect(text).not.toContain('£7,000.00'); expect(text).not.toContain('Pay Less required');
  });
  it('separates unapproved authority from ordinary variance', () => {
    const text = render({ certificate: { ...certificate, sourceAuthority: { ...certificate.sourceAuthority, unapprovedCertifiedGross: 200 } } }).host.textContent;
    expect(text).toContain('BuildLite Assessment is £1,524.00 above'); expect(text).toContain('£200.00 of this assessment has no prior commercial authority');
  });
  it('uses certificate.submit rather than role name', () => {
    expect([...render().host.querySelectorAll('button')].some(button => button.textContent === 'Submit for Approval')).toBe(true);
    act(() => root.unmount()); host.remove(); root = null; auth.permissions = new Set();
    const node = render({ roleName: 'Commercial Director' }).host;
    expect([...node.querySelectorAll('button')].some(button => button.textContent === 'Submit for Approval')).toBe(false); expect(node.textContent).toContain('You do not have permission');
  });
  it('delegates submit and local edit-back actions', () => {
    const rendered = render(); const buttons = [...rendered.host.querySelectorAll('button')];
    act(() => buttons.find(button => button.textContent === 'Submit for Approval').click()); expect(rendered.onSubmit).toHaveBeenCalledTimes(1);
    for (const label of ['Review Application','Review Ordered Works','Review Variations','Review Reconciliation']) act(() => buttons.find(button => button.textContent === label).click());
    expect(rendered.onEditStage.mock.calls.map(([stage]) => stage)).toEqual(['application','ordered-works','variations','reconcile']);
  });
});
