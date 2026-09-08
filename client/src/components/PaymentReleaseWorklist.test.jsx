// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

let canExecute = true;
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: () => canExecute }));
const api = vi.hoisted(() => ({ getPaymentReleaseQueue: vi.fn(), releasePayments: vi.fn() }));
vi.mock('../api/paymentReleases', () => api);
import PaymentReleaseWorklist from './PaymentReleaseWorklist';

const base = { certificateVersion: 3, development: 'Release UAT', supplier: 'Supplier Ltd', packageTrade: 'Drainage', costCode: '4330', paymentAuthorityDate: '2026-09-03T10:00:00Z', finalPaymentDate: '2026-10-08', paymentAuthorityActor: 'Director', authorisedCash: 9120, notifiedSum: 9120, intendedPayment: 9120, noticeMode: 'certificate_as_payment_notice', externalStatus: 'not_exported', warnings: [] };
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
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); canExecute = true; });

  it('defaults to a compact Ready for Accounts view of authorised instructions', () => {
    expect(host.textContent).toContain('Accounts payments');
    expect(host.textContent).toContain('already received commercial approval');
    expect(host.textContent).toContain('Certificate 1');
    expect(host.textContent).not.toContain('Certificate 2');
    expect(host.textContent).toContain('£9,120.00');
    expect(host.textContent).toContain('Ready for Accounts (1)');
    expect(host.textContent).not.toContain('Prior released');
    expect(host.textContent).not.toContain('Releasable');
  });

  it('exposes Needs Review, In Accounts and All deliberately and keeps them non-selectable', async () => {
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent.includes('Needs Review (1)')).click());
    expect(host.textContent).toContain('corrected/reapproved authority is required');
    expect(host.querySelector('input[type="checkbox"]').disabled).toBe(true);
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent.includes('In Accounts (1)')).click());
    expect(host.textContent).toContain('In Accounts');
    expect(host.textContent).toContain('Not exported');
    expect(host.querySelector('input[type="checkbox"]').disabled).toBe(true);
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent.includes('All (3)')).click());
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('requires confirmation and explains Accounts acceptance is not export, posting or payment', async () => {
    await act(async () => host.querySelector('input[type="checkbox"]').click());
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent.includes('Accept into Accounts')).click());
    expect(api.releasePayments).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain('does not mean it has been exported, posted or paid');
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent === 'Cancel').click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('submits decision identity once and reloads authoritative state', async () => {
    await act(async () => host.querySelector('input[type="checkbox"]').click());
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent.includes('Accept into Accounts')).click());
    await act(async () => [...host.querySelectorAll('button')].find(node => node.textContent === 'Accept into Accounts').click());
    expect(api.releasePayments).toHaveBeenCalledTimes(1);
    expect(api.releasePayments.mock.calls[0][0].paymentAuthorityDecisionIds).toEqual(['d1']);
    expect(api.releasePayments.mock.calls[0][0].reason).toBe('Accounts handoff accepted');
    expect(api.releasePayments.mock.calls[0][0]).not.toHaveProperty('amount');
    expect(api.getPaymentReleaseQueue).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Not exported, posted or paid');
  });

  it('denies the Accounts workflow when the permission is absent', async () => {
    await act(async () => root.unmount());
    canExecute = false;
    root = createRoot(host);
    await act(async () => root.render(<PaymentReleaseWorklist/>));
    expect(host.textContent).toContain('Accounts payments');
    expect(host.textContent).toContain('do not have permission');
    expect(api.getPaymentReleaseQueue).toHaveBeenCalledTimes(1);
  });
});
