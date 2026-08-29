/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentCertificateCommercialEvents from './PaymentCertificateCommercialEvents';
import { buildCommercialSummaryItems } from '../payments/paymentCertificateProgress';

const removeLine = vi.fn(() => ({ ok: true }));

vi.mock('../payments/paymentCertificateStore', () => ({
  addCommercialLineToCertificate: vi.fn(),
  removeCommercialLineFromCertificate: (...args) => removeLine(...args),
  updateCommercialLineAmount: vi.fn(() => ({ ok: true })),
}));

vi.mock('../payments/certificateCommercialLines', () => ({
  buildCertificateCommercialLineRows: () => [
    {
      id: 'ce-line', eventNumber: 'CE-0010', typeLabel: 'Commercial Event',
      description: 'Client change', approvedValue: 2000, previouslyCertified: 0,
      amountThisCertificate: 500, remaining: 1500,
    },
    {
      id: 'vo-line', eventNumber: 'PO-001/VO-0001', typeLabel: 'Issued VO',
      description: 'Formal instruction', approvedValue: 4500, previouslyCertified: 0,
      amountThisCertificate: 1000, remaining: 3500,
    },
  ],
  buildSelectedCommercialEventPreview: () => null,
  formatSignedCommercialLineTotal: (value) => `+£${Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
  formatEligibleCommercialEventOptionLabel: () => '',
  listEligibleCommercialEvents: () => [],
}));

describe('Payment Certificate commercial-adjustment presentation', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('renders CE and VO sources together with distinct type and immutable reference', () => {
    act(() => root.render(
      <PaymentCertificateCommercialEvents
        orderKey="order-1"
        order={{ developmentId: 'dev-1' }}
        certificate={{ id: 'cert-1', commercialLines: [] }}
        editable
        onLinesChanged={vi.fn()}
      >
        <div>Add Issued Variation Order</div>
      </PaymentCertificateCommercialEvents>
    ));

    expect(container.textContent).toContain('Commercial Adjustments');
    expect(container.textContent).toContain('Add Issued Variation Order');
    expect(container.textContent).toContain('Included on this certificate');
    expect(container.textContent).toContain('Commercial Event');
    expect(container.textContent).toContain('CE-0010');
    expect(container.textContent).toContain('Issued VO');
    expect(container.textContent).toContain('PO-001/VO-0001');
    expect(container.textContent).toContain('No eligible approved commercial events');
    expect(container.querySelectorAll('button').length).toBe(2);
    act(() => container.querySelector('button').click());
    expect(removeLine).toHaveBeenCalledWith('order-1', 'cert-1', 'ce-line', { developmentId: 'dev-1' });
  });

  it('uses the broader Commercial Adjustments summary label without changing value', () => {
    const items = buildCommercialSummaryItems({
      matrixGrossThisCertificate: 0,
      commercialEventGrossThisCertificate: 1000,
      grossWorksThisCertificate: 1000,
      previousGrossWorks: 0,
      certifiedToDate: 1000,
      remainingContract: 3500,
      retention: 50,
      vat: 190,
      netPayment: 1140,
    });
    expect(items).toContainEqual({ label: 'Commercial Adjustments', value: '+£1,000.00' });
  });
});
