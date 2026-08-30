/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentCertificateDetail from './PaymentCertificateDetail';

const approveCertificate = vi.fn();
const submitCertificate = vi.fn();
const getCertificate = vi.fn();
const summarizeCertificateProgress = vi.fn();

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
  buildCertificateAuditItems: () => [],
  buildCertificateHeaderMeta: () => [],
}));

vi.mock('../payments/paymentCertificateProgress', () => ({
  buildCommercialSummaryItems: () => [],
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
});
