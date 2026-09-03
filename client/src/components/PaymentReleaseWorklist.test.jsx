// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: () => true }));
const api = vi.hoisted(() => ({ getPaymentReleaseQueue: vi.fn(), releasePayments: vi.fn() }));
vi.mock('../api/paymentReleases', () => api);
import PaymentReleaseWorklist from './PaymentReleaseWorklist';

const base = { certificateVersion: 3, development: 'Release UAT', supplier: 'Supplier Ltd', packageTrade: 'Drainage', costCode: '4330', paymentAuthorityDate: '2026-09-03T10:00:00Z', finalPaymentDate: '2026-10-08', paymentAuthorityActor: 'Director', authorisedCash: 9120, notifiedSum: 9120, intendedPayment: 9120, noticeMode: 'certificate_as_payment_notice', externalStatus: 'not_exported', warnings: ['Verified bank details are not held; Release stops at Accounts.'] };
const ready = { ...base, id: 'd1', paymentAuthorityDecisionId: 'd1', certificateId: 'c1', certificateNumber: 1, workflowState: 'ready', eligible: true, previouslyReleased: 0, releasableCash: 9120, reasons: [] };
const review = { ...base, id: 'd2', paymentAuthorityDecisionId: 'd2', certificateId: 'c2', certificateNumber: 2, workflowState: 'needs_review', eligible: false, previouslyReleased: 0, releasableCash: 0, reasons: ['Payment Authority changed after approval; corrected/reapproved authority is required.'] };
const released = { ...base, id: 'd3', paymentAuthorityDecisionId: 'd3', certificateId: 'c3', certificateNumber: 3, workflowState: 'released', eligible: false, previouslyReleased: 9120, releasableCash: 0, reasons: [] };

describe('PaymentReleaseWorklist', () => {
  let host;
  let root;
  beforeEach(async () => {
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    api.getPaymentReleaseQueue.mockResolvedValue([ready, review, released]);
    api.releasePayments.mockResolvedValue({ itemCount: 1, totalReleased: 9120 });
    await act(async () => root.render(<PaymentReleaseWorklist/>));
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });

  it('defaults to Ready to Release and keeps authorised, prior and releasable cash distinct', () => {
    expect(host.textContent).toContain('Certificate 1');
    expect(host.textContent).not.toContain('Certificate 2');
    expect(host.textContent).toContain('£9,120.00');
    expect(host.textContent).toContain('£0.00');
    expect(host.textContent).toContain('Ready to Release (1)');
    expect(host.textContent).toContain('Not exported');
  });

  it('exposes Needs Review, Released and All deliberately and keeps them non-selectable', async () => {
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent.includes('Needs Review (1)')).click());
    expect(host.textContent).toContain('corrected/reapproved authority is required');
    expect(host.querySelector('input[type="checkbox"]').disabled).toBe(true);
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent.includes('Released (1)')).click());
    expect(host.textContent).toContain('Released to Accounts');
    expect(host.querySelector('input[type="checkbox"]').disabled).toBe(true);
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent.includes('All (3)')).click());
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('requires confirmation and explains Release is not external payment', async () => {
    await act(async () => host.querySelector('input[type="checkbox"]').click());
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent.includes('Review Release')).click());
    expect(api.releasePayments).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain('does not mean the payment has been paid by a bank');
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent === 'Cancel').click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('submits decision identity once and reloads authoritative state', async () => {
    await act(async () => host.querySelector('input[type="checkbox"]').click());
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent.includes('Review Release')).click());
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent === 'Release to Accounts').click());
    expect(api.releasePayments).toHaveBeenCalledTimes(1);
    expect(api.releasePayments.mock.calls[0][0].paymentAuthorityDecisionIds).toEqual(['d1']);
    expect(api.releasePayments.mock.calls[0][0]).not.toHaveProperty('amount');
    expect(api.getPaymentReleaseQueue).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Not paid or exported');
  });
});
