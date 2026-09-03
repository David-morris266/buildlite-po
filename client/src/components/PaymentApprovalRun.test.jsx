// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: () => true }));
const api = vi.hoisted(() => ({ getPaymentApprovalQueue: vi.fn(), approvePaymentAuthorityRun: vi.fn() }));
vi.mock('../api/paymentAuthority', () => api);
import PaymentApprovalRun from './PaymentApprovalRun';

const base = {
  certificateVersion: 4, development: 'Disposable', subcontractor: 'Subcontractor', packageTrade: 'Drainage',
  finalPaymentDate: '2026-10-06', gross: 8000, retention: 400, vat: 1520, net: 9120,
  notifiedSum: 9120, intendedPayment: 9120, payLessReduction: 0, noticeMode: 'certificate_as_payment_notice',
  releaseStatus: 'not_released', unapprovedAtLock: 8000,
  lines: [{ assessmentId: 'a1', reference: 'VA-0001', description: 'Drainage changes', unapprovedAtLock: 8000, existingSupportOptions: [] }],
};
const ready = { ...base, id: 'c1', certificateId: 'c1', certificateNumber: 1, priorCashAuthority: 0, cashAmountProposed: 9120, eligible: true, workflowState: 'ready', statusSummary: 'Ready', reasons: [] };
const authorised = { ...base, id: 'c2', certificateId: 'c2', certificateNumber: 2, priorCashAuthority: 9120, cashAmountProposed: 0, newCommercialAuthorityProposed: 0, authorisedCashAmount: 9120, authorisedNewCommercialAuthority: 8000, eligible: false, workflowState: 'authorised', statusSummary: 'Authority already granted', reasons: ['Payment Authority cash is already fully granted.'] };
const review = { ...base, id: 'c3', certificateId: 'c3', certificateNumber: 3, cashAmountProposed: 0, eligible: false, workflowState: 'needs_review', statusSummary: 'Pay Less required', reasons: ['A valid Issued Pay Less Notice is required for the reduced intended payment.'] };

describe('PaymentApprovalRun', () => {
  let host;
  let root;
  beforeEach(async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    api.getPaymentApprovalQueue.mockResolvedValue([ready, review, authorised]);
    api.approvePaymentAuthorityRun.mockResolvedValue({ results: [{ ok: true }] });
    await act(async () => root.render(<PaymentApprovalRun/>));
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });

  it('defaults to the actionable Ready worklist', () => {
    expect(host.textContent).toContain('Certificate 1');
    expect(host.textContent).not.toContain('Certificate 2');
    expect(host.textContent).not.toContain('Certificate 3');
    expect(host.textContent).toContain('Ready (1)');
  });

  it('shows authorised history with granted commercial and cash amounts separately and no release implication', async () => {
    const button = [...host.querySelectorAll('button')].find(node => node.textContent.includes('Authorised (1)'));
    await act(async () => button.click());
    expect(host.textContent).toContain('Certificate 2');
    expect(host.textContent).toContain('Authorised');
    expect(host.textContent).toContain('£8,000.00');
    expect(host.textContent).toContain('£9,120.00');
    expect(host.textContent).toContain('Payment Release not created');
    expect(host.querySelector('input[type="checkbox"]').disabled).toBe(true);
  });

  it('preserves concise and full exception information in Needs Review', async () => {
    const button = [...host.querySelectorAll('button')].find(node => node.textContent.includes('Needs Review (1)'));
    await act(async () => button.click());
    expect(host.textContent).toContain('Certificate 3');
    expect(host.textContent).toContain('Pay Less required');
    expect(host.querySelector('td[title]')?.title).toContain('Issued Pay Less Notice');
  });

  it('exposes complete history deliberately through All', async () => {
    const button = [...host.querySelectorAll('button')].find(node => node.textContent.includes('All (3)'));
    await act(async () => button.click());
    expect(host.textContent).toContain('Certificate 1');
    expect(host.textContent).toContain('Certificate 2');
    expect(host.textContent).toContain('Certificate 3');
  });

  it('submits only a selected Ready row with locked version and VA line', async () => {
    const checkbox = host.querySelector('input[type="checkbox"]');
    await act(async () => checkbox.click());
    const button = [...host.querySelectorAll('button')].find(node => node.textContent.includes('Approve selected'));
    await act(async () => button.click());
    expect(api.approvePaymentAuthorityRun).toHaveBeenCalledTimes(1);
    const payload = api.approvePaymentAuthorityRun.mock.calls[0][0];
    expect(payload.decisions[0].certificateVersion).toBe(4);
    expect(payload.decisions[0].cashAmount).toBe(9120);
    expect(payload.decisions[0].lines[0]).toMatchObject({ assessmentId: 'a1', newCommercialAuthority: 8000, supportUsages: [] });
  });
});
