/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentCertificateDetail, { resolveCertificatePackageId } from './PaymentCertificateDetail';
import { normalizeServerPaymentCertificate } from '../payments/paymentCertificateServerMapper';

const approveCertificate = vi.fn();
const submitCertificate = vi.fn();
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
  rejectCertificate: vi.fn(),
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
  getPackageDisplayName: () => 'Sparktastic Ltd',
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

vi.mock('./PaymentCertificateApplication', () => ({ default: () => <div>Subcontractor Application</div> }));
vi.mock('./PaymentCertificateVariationAssessments', () => ({ default: () => <div>Variation Account assessment</div> }));
vi.mock('./PaymentCertificateSourceAuthority', () => ({ default: () => <div>Source authority</div> }));
vi.mock('./PaymentCertificateVariationOrders', () => ({ default: () => <div>Variation orders</div> }));
vi.mock('./PaymentCertificateTerms', () => ({ default: () => <div>Governing Terms</div> }));
vi.mock('./PaymentCertificateTimetable', () => ({ default: () => <div>Contractual Timetable</div> }));
vi.mock('./PaymentCertificateNotices', () => ({ default: () => <div>Payment Notices</div> }));
vi.mock('./PaymentCertificateDocuments', () => ({ default: () => <div>Commercial Documents</div> }));

vi.mock('./layout/ApplicationPageHeader', () => ({
  default: ({ title, children }) => (
    <div>
      <h1>{title}</h1>
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

  function renderDetail(onProgressChanged = vi.fn()) {
    act(() => {
      root.render(
        <PaymentCertificateDetail
          order={baseOrder}
          certificateId="cert-3"
          onBack={vi.fn()}
          onProgressChanged={onProgressChanged}
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
    expect(document.body.textContent).toContain('Review & Submit');
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
      '5Release',
    ]);
    expect(document.body.textContent).toContain('Subcontractor Application');
    expect(document.body.textContent).toContain('Valuation grid');
    const applicationNode = [...document.querySelectorAll('div')].find((node) => node.childNodes.length === 1 && node.textContent === 'Subcontractor Application');

    clickButton('Ordered Works');
    expect(document.querySelector('[aria-current="step"]').textContent).toContain('Ordered Works');
    expect(document.body.textContent).toContain('Valuation grid');

    clickButton('Variations');
    expect(document.body.textContent).toContain('Existing certificate functionality will be brought into this stage in the next controlled slice.');
    expect(document.body.textContent).toContain('Subcontractor Application');
    expect(document.body.textContent).toContain('Valuation grid');
    expect([...document.querySelectorAll('div')]).toContain(applicationNode);
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

  function clickButton(label) {
    const button = [...document.querySelectorAll('button')].find((node) =>
      node.textContent?.includes(label)
    );
    expect(button).toBeTruthy();
    act(() => {
      button.click();
    });
  }

  async function clickDialogConfirm() {
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const button = [...dialog.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Approve & Lock')
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button.click();
    });
  }

  it('E. keeps approval dialog open and surfaces validation errors when approve fails', async () => {
    renderDetail();
    clickButton('Approve & Lock');
    expect(document.body.textContent).toContain('Approve & lock Certificate No. 3?');

    await clickDialogConfirm();

    expect(approveCertificate).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('Approve & lock Certificate No. 3?');
    expect(document.body.textContent).toContain(
      'CE-0019 is now Closed and can no longer be deducted'
    );
  });

  it('disables duplicate approve clicks while the request is in flight', async () => {
    let resolveApprove;
    approveCertificate.mockReturnValue(
      new Promise((resolve) => {
        resolveApprove = resolve;
      })
    );
    renderDetail();
    clickButton('Approve & Lock');
    const dialog = document.querySelector('[role="dialog"]');
    const confirm = [...dialog.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Approve & Lock')
    );
    await act(async () => {
      confirm.click();
    });
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      confirm.click();
    });
    expect(approveCertificate).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveApprove({ ok: true, certificate: { status: 'locked' } });
    });
  });

  it('opens a visible confirmation without submitting, then Cancel leaves the Draft untouched', () => {
    setDraftCertificate();
    renderDetail();

    clickButton('Review & Submit');

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Submit Payment Certificate for Approval?');
    expect(dialog.textContent).toContain('freeze the current valuation and commercial assessment');
    expect(submitCertificate).not.toHaveBeenCalled();

    clickButton('Cancel');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(submitCertificate).not.toHaveBeenCalled();
  });

  it('submits a valid £0 Draft once on final confirmation and closes on success', async () => {
    setDraftCertificate();
    submitCertificate.mockResolvedValue({ ok: true, certificate: { status: 'submitted' } });
    const onProgressChanged = renderDetail();
    clickButton('Review & Submit');

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
    clickButton('Review & Submit');

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
    expect(text.match(/Source authority/g)).toHaveLength(1);
    expect(text).not.toContain('Contractual Timetable');
    expect(text).toContain('Review & Submit');
    expect(text).toContain('Unapproved certified gross is £200.00');
    expect(text).toContain('£1000.00');
    expect(text).toContain('£1140.00');
    expect(text.match(/Subcontractor Application/g)).toHaveLength(1);
    expect(text.match(/Valuation Matrix/g)).toHaveLength(1);
  });

  it('prioritises payment controls when Locked and collapses audit by default', async () => {
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
    expect(text).toContain('Frozen commercial position');
    expect(text).toContain('Difference−£500.00');
    expect(text.indexOf('Subcontractor Application')).toBeLessThan(text.indexOf('Contractual Timetable'));
    expect(text.indexOf('Contractual Timetable')).toBeLessThan(text.indexOf('Payment Notices'));
    expect(text.indexOf('Payment Notices')).toBeLessThan(text.indexOf('Commercial Documents'));
    expect(text.indexOf('Commercial Documents')).toBeLessThan(text.indexOf('Frozen Valuation Detail'));
    expect(document.querySelector('.po-cert-detail__audit').open).toBe(false);
    expect(text).toContain('approved and permanently locked');
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
