/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentCertificateDetail, { resolveCertificatePackageId } from './PaymentCertificateDetail';
import { normalizeServerPaymentCertificate } from '../payments/paymentCertificateServerMapper';

vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: () => true }));

const approveCertificate = vi.fn();
const submitCertificate = vi.fn();
const rejectCertificate = vi.fn();
const getCertificate = vi.fn();
const summarizeCertificateProgress = vi.fn();
const buildCertificateAuditItems = vi.fn(() => []);

vi.mock('../payments/paymentCertificateStore', () => ({
  approveCertificate: (...args) => approveCertificate(...args),
  submitCertificate: (...args) => submitCertificate(...args),
  getCertificate: (...args) => getCertificate(...args),
  getCertificateStatusMeta: (status) => ({ label: status, modifier: status }),
  isCertificateEditable: (certificate) => certificate?.status === 'draft',
  isCertificateSubmitted: (certificate) => certificate?.status === 'submitted',
  rejectCertificate: (...args) => rejectCertificate(...args),
  deleteCertificate: vi.fn(),
  updateCertificateProgress: vi.fn(),
}));

vi.mock('../payments/paymentCertificateApproval', () => ({
  buildCertificateAuditItems: (...args) => buildCertificateAuditItems(...args),
  buildCertificateHeaderMeta: () => [],
}));

vi.mock('../payments/paymentCertificateProgress', () => ({
  buildCommercialSummaryItems: () => [],
  formatMoneyLabel: (value) => value == null ? '—' : `£${Number(value).toFixed(2)}`,
  summarizeCertificateProgress: (...args) => summarizeCertificateProgress(...args),
}));

vi.mock('../payments/paymentCertificate', () => ({
  getPackageDevelopmentName: () => 'Test Site 1',
  getPackageDisplayName: () => 'Sparktastic Ltd Package',
}));

vi.mock('./PaymentCertificateValuationGrid', () => ({
  default: () => <div>Valuation grid</div>,
}));

vi.mock('./PaymentCertificateCommercialEvents', () => ({
  default: () => <div>Commercial events</div>,
}));

vi.mock('./PaymentCertificateRecoveryDeductions', () => ({
  default: () => <div>Recovery deductions</div>,
}));

let applicationComparisonCallback = null;
vi.mock('./PaymentCertificateApplication', () => ({ default: ({ onComparisonChanged }) => {
  applicationComparisonCallback = onComparisonChanged;
  return <div>Subcontractor Application</div>;
} }));
vi.mock('./PaymentCertificateVariationAssessments', () => ({ default: () => <div>Variation Account assessment</div> }));
vi.mock('./PaymentCertificateVariationsWorkspace', () => ({ default: () => <div>Stage 3 variation workspace</div> }));
vi.mock('./PaymentCertificateSourceAuthority', () => ({ default: () => <div>Source authority</div> }));
vi.mock('./PaymentCertificateVariationOrders', () => ({ default: () => <div>Variation orders</div> }));
vi.mock('./PaymentCertificateTerms', () => ({ default: () => <div>Governing Terms</div> }));
vi.mock('./PaymentCertificateTimetable', () => ({ default: () => <div>Contractual Timetable</div> }));
vi.mock('./PaymentCertificateNotices', () => ({ default: () => <div>Payment Notices</div> }));
vi.mock('./PaymentCertificateDocuments', () => ({ default: () => <div>Commercial Documents</div> }));

vi.mock('./layout/ApplicationPageHeader', () => ({
  default: ({ title, lead, children }) => (
    <div>
      <h1>{title}</h1>
      <p>{lead}</p>
      {children}
    </div>
  ),
}));

const baseOrder = {
  orderKey: 'dev::sup::5215',
  developmentId: 'dev',
  supplierLabel: 'Sparktastic Ltd',
};

describe('PaymentCertificateDetail workflow feedback', () => {
  let container;
  let root;

  beforeEach(() => {
    applicationComparisonCallback = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    getCertificate.mockReturnValue({
      id: 'cert-3',
      certificateNumber: 3,
      status: 'submitted',
      commercialLines: [],
    });
    summarizeCertificateProgress.mockReturnValue({
      certificate: getCertificate(),
      totals: { netPayment: 1000 },
      matrix: {},
      grid: { cells: [] },
    });
    approveCertificate.mockReturnValue({
      ok: false,
      errors: [
        'CE-0019 is now Closed and can no longer be deducted. Remove this recovery line before approving the certificate.',
      ],
    });
    submitCertificate.mockReturnValue({ ok: true });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  function renderDetail(onProgressChanged = vi.fn(), props = {}) {
    act(() => {
      root.render(
        <PaymentCertificateDetail
          order={baseOrder}
          certificateId="cert-3"
          onBack={vi.fn()}
          onProgressChanged={onProgressChanged}
          {...props}
        />
      );
    });
    return onProgressChanged;
  }

  function setDraftCertificate() {
    const certificate = {
      id: 'cert-3',
      certificateNumber: 3,
      status: 'draft',
      commercialLines: [],
    };
    getCertificate.mockReturnValue(certificate);
    summarizeCertificateProgress.mockReturnValue({
      certificate,
      totals: {
        grossWorksThisCertificate: 0,
        netPayment: 0,
      },
      matrix: {},
      grid: { cells: [] },
      matrixReady: true,
    });
  }

  it('shows Delete Draft when the Draft has never been submitted', () => {
    setDraftCertificate();
    renderDetail();
    expect(document.body.textContent).toContain('Delete Draft');
  });

  it('hides Delete Draft after a submitted certificate is rejected back to Draft', () => {
    setDraftCertificate();
    const certificate = { ...getCertificate(), hasSubmissionHistory: true };
    getCertificate.mockReturnValue(certificate);
    summarizeCertificateProgress.mockReturnValue({
      certificate,
      totals: { grossWorksThisCertificate: 0, netPayment: 0 },
      matrix: {},
      grid: { cells: [] },
      matrixReady: true,
    });
    renderDetail();
    expect(document.body.textContent).not.toContain('Delete Draft');
    expect(document.body.textContent).not.toContain('Review & Submit');
    expect(document.body.textContent).toContain('Save Draft');
  });

  it('renders five freely selectable Draft stages while keeping Application and Matrix mounted', () => {
    setDraftCertificate();
    renderDetail();

    const stageNav = document.querySelector('[aria-label="Certificate assessment stages"]');
    expect(stageNav).toBeTruthy();
    expect([...stageNav.querySelectorAll('button')].map((button) => button.textContent.trim())).toEqual([
      '1Application',
      '2Ordered Works',
      '3Variations',
      '4Reconcile',
      '5Submit',
    ]);
    expect(document.body.textContent).toContain('Subcontractor Application');
    expect(document.body.textContent).toContain('Valuation grid');
    const applicationNode = [...document.querySelectorAll('div')].find((node) => node.childNodes.length === 1 && node.textContent === 'Subcontractor Application');

    clickButton('Ordered Works');
    expect(document.querySelector('[aria-current="step"]').textContent).toContain('Ordered Works');
    expect(document.body.textContent).toContain('Valuation grid');

    clickButton('Variations');
    expect(document.body.textContent).toContain('Stage 3 variation workspace');
    expect(document.body.textContent).not.toContain('Existing certificate functionality will be brought into this stage in the next controlled slice.');
    expect(document.body.textContent).toContain('Subcontractor Application');
    expect(document.body.textContent).toContain('Valuation grid');
    expect([...document.querySelectorAll('div')]).toContain(applicationNode);
    const variationsNode = [...document.querySelectorAll('div')].find((node) => node.childNodes.length === 1 && node.textContent === 'Stage 3 variation workspace');

    clickButton('Application');
    expect([...document.querySelectorAll('div')]).toContain(variationsNode);
    clickButton('Variations');
    expect([...document.querySelectorAll('div')]).toContain(variationsNode);

    clickButton('Reconcile');
    expect(document.body.textContent).toContain('Compare the contractor application with BuildLite');
    expect(document.body.textContent).not.toContain('Existing certificate functionality will be brought into this stage in the next controlled slice.');
    clickButton('Edit Ordered Works');
    expect(document.querySelector('[aria-current="step"]').textContent).toContain('Ordered Works');
  });

  it('uses the authoritative summary values in the compact Draft commercial strip', () => {
    setDraftCertificate();
    summarizeCertificateProgress.mockReturnValue({
      ...summarizeCertificateProgress(),
      totals: { grossWorksThisCertificate: 800, netPayment: 912 },
    });
    renderDetail();
    const strip = document.querySelector('[aria-label="Commercial position"]');
    expect(strip.textContent).toContain('Assessment£800.00');
    expect(strip.textContent).toContain('Net£912.00');
    expect(strip.textContent).toContain('Difference—');
  });

  it('shows a net-only contractor request without treating it as gross or replacing assessed net', () => {
    setDraftCertificate();
    const netOnlyComparison = {
      comparable: false,
      applicationBasis: 'net_only',
      applicationCurrentGross: null,
      applicationNetRequested: 10000,
      difference: null,
    };
    summarizeCertificateProgress.mockReturnValue({
      ...summarizeCertificateProgress(),
      totals: { grossWorksThisCertificate: 0, netPayment: 0 },
    });
    renderDetail();
    act(() => applicationComparisonCallback(netOnlyComparison));
    const strip = document.querySelector('[aria-label="Commercial position"]');
    const items = [...strip.querySelectorAll('div')];
    expect(items.find((item) => item.querySelector('dt')?.textContent === 'Application').textContent).toContain('10000.00Net only');
    expect(items.find((item) => item.querySelector('dt')?.textContent === 'Assessment').textContent).toContain('0.00');
    expect(items.find((item) => item.querySelector('dt')?.textContent === 'Difference').textContent).toContain('Gross comparison unavailable');
    expect(items.find((item) => item.querySelector('dt')?.textContent === 'Net').textContent).toContain('0.00');
  });

  function clickButton(label) {
    const button = [...document.querySelectorAll('button')].find((node) =>
      node.textContent?.includes(label)
    );
    expect(button).toBeTruthy();
    act(() => {
      button.click();
    });
  }

  function expectViewportDialog() {
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const backdrop = dialog.parentElement;
    expect(backdrop.classList.contains('po-cert-delete-backdrop')).toBe(true);
    expect(backdrop.parentElement).toBe(document.body);
    return dialog;
  }

  it('opens a visible confirmation without submitting, then Cancel leaves the Draft untouched', () => {
    setDraftCertificate();
    renderDetail();

    clickButton('Submit');
    clickButton('Submit for Approval');

    const dialog = expectViewportDialog();
    expect(dialog.textContent).toContain('Submit Payment Certificate for Approval?');
    expect(dialog.textContent).toContain('Final financial and source-authority evidence is frozen when the certificate is approved and locked.');
    expect(submitCertificate).not.toHaveBeenCalled();

    clickButton('Cancel');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(submitCertificate).not.toHaveBeenCalled();
    clickButton('Submit for Approval');
    expectViewportDialog();
    clickButton('Cancel');
  });

  it('submits a valid £0 Draft once on final confirmation and closes on success', async () => {
    setDraftCertificate();
    submitCertificate.mockResolvedValue({ ok: true, certificate: { status: 'submitted' } });
    const onProgressChanged = renderDetail();
    clickButton('Submit');
    clickButton('Submit for Approval');

    const dialog = document.querySelector('[role="dialog"]');
    const confirm = [...dialog.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Submit for Approval')
    );
    await act(async () => confirm.click());

    expect(submitCertificate).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onProgressChanged).toHaveBeenCalled();
  });

  it('keeps a server rejection visible and restores the final confirmation control', async () => {
    setDraftCertificate();
    submitCertificate.mockResolvedValue({ ok: false, errors: ['Submission rejected clearly.'] });
    renderDetail();
    clickButton('Submit');
    clickButton('Submit for Approval');

    const dialog = document.querySelector('[role="dialog"]');
    const confirm = [...dialog.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Submit for Approval')
    );
    await act(async () => confirm.click());

    expect(submitCertificate).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('Submission rejected clearly.');
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(confirm.disabled).toBe(false);
  });

  it('keeps genuine authority exceptions visible without restoring the long Draft record', () => {
    setDraftCertificate();
    const certificate = { ...getCertificate(), sourceAuthority: { unapprovedCertifiedGross: 200 } };
    getCertificate.mockReturnValue(certificate);
    summarizeCertificateProgress.mockReturnValue({
      certificate,
      totals: {
        grossWorksThisCertificate: 1000,
        retention: 50,
        recoveryDeductionMagnitude: 0,
        netPayment: 1140,
        previousCertified: 0,
        certifiedToDate: 1000,
      },
      matrix: {},
      grid: { cells: [] },
      matrixReady: true,
    });
    renderDetail();

    const text = document.body.textContent;
    expect(text.indexOf('Commercial position')).toBeLessThan(text.indexOf('Subcontractor Application'));
    expect(text).not.toContain('Variation Account assessment');
    expect(text).not.toContain('Source authority');
    expect(text).not.toContain('Contractual Timetable');
    expect(text).not.toContain('Review & Submit');
    expect(text).toContain('Save Draft');
    expect(text).toContain('Delete Draft');
    expect(text).toContain('£200.00 of this assessment has no prior commercial authority. Review before submitting.');
    expect(text).toContain('£1000.00');
    expect(text).toContain('£1140.00');
    expect(text.match(/Subcontractor Application/g)).toHaveLength(1);
    expect(text.match(/Valuation Matrix/g)).toHaveLength(1);
  });

  it('uses the known workspace development name and retains package and supplier identity', () => {
    setDraftCertificate();
    renderDetail(vi.fn(), { developmentName: 'Hawthorn Gardens UAT' });
    expect(document.body.textContent).toContain('Hawthorn Gardens UAT · Sparktastic Ltd Package · Sparktastic Ltd');
  });

  it('falls back to the order development label when workspace identity is unavailable', () => {
    setDraftCertificate();
    renderDetail();
    expect(document.body.textContent).toContain('Test Site 1 · Sparktastic Ltd Package · Sparktastic Ltd');
  });

  it('routes Submitted certificates to the dedicated approver workspace instead of the legacy dossier', () => {
    const certificate = {
      id: 'cert-3', certificateNumber: 3, status: 'submitted', submittedBy: 'David Morris', submittedAt: '2026-09-06T20:08:26.288Z',
      submissionApplicationSnapshot: { application: { applicationReference: 'ABC', receivedAt: '2026-09-05' }, comparison: { comparable: true, applicationCurrentGross: 10000, difference: 4834 } },
      paymentTimetable: { readiness: 'review_required', reasons: ['Governing payment-rule authority requires review.'] },
      sourceAuthority: { variationAssessmentGross: 5000, unapprovedCertifiedGross: 0, evidence: { variationAssessments: [{ id: 'a1', signedAmount: 5000, unapprovedAmount: 0 }] } },
    };
    getCertificate.mockReturnValue(certificate);
    summarizeCertificateProgress.mockReturnValue({ certificate, totals: { matrixGrossThisCertificate: 9834, commercialEventGrossThisCertificate: 5000, grossWorksThisCertificate: 14834, retention: 741.7, recoveryDeductionSigned: 0, vat: 2818.46, netPayment: 16910.76, previousCertified: 30000, certifiedToDate: 44834, currentContractValue: 118000, remainingContract: 73166 }, matrix: {}, grid: { cells: [] }, matrixReady: true });
    renderDetail();
    const text = document.body.textContent;
    expect(text).toContain('Certificate decision');
    expect(text).toContain('Submitted by David Morris');
    expect(text).toContain('Contractor Application£10000.00');
    expect(text).toContain('BuildLite Assessment£14834.00');
    expect(text).toContain('Use the Payment Approval worklist');
    expect(text).not.toContain('Approve & Lock');
    expect(text).toContain('Return to Draft');
    expect(text).not.toContain('Subcontractor Application');
    expect(text).not.toContain('Commercial events');
    expect(text).not.toContain('Recovery deductions');
    expect(text).not.toContain('Payment Notices');
    expect(text).not.toContain('Commercial Documents');
    expect(document.querySelector('.po-cert-detail__matrix')).toBeNull();
    expect(document.querySelector('.po-cert-approval__valuation')?.textContent).toContain('Valuation grid');
  });

  it('mounts Submitted lifecycle dialogs at viewport level and Cancel restores interaction without mutation', () => {
    renderDetail();

    clickButton('Return to Draft');
    expectViewportDialog();
    clickButton('Cancel');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(rejectCertificate).not.toHaveBeenCalled();

    expect(approveCertificate).not.toHaveBeenCalled();
  });

  it('requires a Return-to-Draft reason before confirming the lifecycle action', () => {
    renderDetail();
    clickButton('Return to Draft');
    const dialog = document.querySelector('[role="dialog"]');
    const confirm = [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Return to Draft');
    expect(dialog.textContent).toContain('Return-to-Draft reason');
    expect(confirm.disabled).toBe(true);
    expect(rejectCertificate).not.toHaveBeenCalled();
  });

  it('routes Locked certificates to the immutable record and keeps forensic evidence collapsed', async () => {
    const certificate = {
      id: 'cert-3',
      certificateNumber: 3,
      status: 'locked',
      commercialLines: [],
      lockedApplicationSnapshot: {
        comparison: {
          comparable: true,
          applicationCurrentGross: 1500,
          difference: -500,
        },
      },
    };
    buildCertificateAuditItems.mockReturnValue([{ id: 'locked', label: 'Approved', actor: 'David', dateLabel: '2 Sep' }]);
    getCertificate.mockReturnValue(certificate);
    summarizeCertificateProgress.mockReturnValue({
      certificate,
      totals: { grossWorksThisCertificate: 1000, retention: 50, recoveryDeductionMagnitude: 0, netPayment: 1140, previousCertified: 0, certifiedToDate: 1000 },
      matrixReady: true,
      fromValuationSnapshot: true,
      grid: { cells: [] },
    });
    renderDetail();
    await act(async () => {});

    const text = document.body.textContent;
    expect(text).toContain('Immutable commercial record');
    expect(text).toContain('Difference−£500.00');
    expect(text.indexOf('View supporting detail')).toBeLessThan(text.indexOf('Notice & documents'));
    expect(text.indexOf('Frozen Valuation Detail')).toBeLessThan(text.indexOf('Notice & documents'));
    expect(document.querySelector('.po-cert-locked__supporting').open).toBe(false);
    expect(document.querySelector('.po-cert-detail__audit').open).toBe(false);
    expect(text).toContain('Certificate values are permanently locked');
    expect(text).not.toContain('Current Contract');
  });
});

describe('PaymentCertificateDetail package identity', () => {
  it('uses the real mapped server-certificate package UUID when the PO-derived view has no UUID', () => {
    const certificate = normalizeServerPaymentCertificate({
      id: 'cert-authoritative',
      packageId: 'pkg-authoritative',
      status: 'draft',
    });

    expect(certificate.packageUuid).toBe('pkg-authoritative');
    expect(certificate.packageId).toBeUndefined();
    expect(
      resolveCertificatePackageId(certificate, {}, {
        orderKey: 'dev::supplier::4330',
      })
    ).toBe('pkg-authoritative');
  });
});
