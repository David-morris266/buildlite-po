/* @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listCertificateRegister = vi.fn();
vi.mock('../api', () => ({ listCertificateRegister: (...args) => listCertificateRegister(...args) }));
import CertificateRegister from './CertificateRegister';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container; let root;
const payload = { total: 1, page: 1, pageSize: 25, options: { developments: [{ id: 'd1', label: 'Oak Meadow · JB-OM-001' }], suppliers: [{ id: 's1', label: 'Groundworks Ltd' }] }, items: [{ id: 'c1', orderKey: 'd1::s1::100', certificateNumber: 2, certificateDate: '2026-08-31', status: 'locked', developmentId: 'd1', developmentNumber: 'JB-OM-001', developmentName: 'Oak Meadow', supplierId: 's1', supplierName: 'Groundworks Ltd', costCode: '100', packageDescription: 'Groundworks', poReferences: 'S001', grossValue: 0, retention: null, netPayment: 125.5, approvedBy: 'Commercial Director' }] };
async function settle(ms = 40) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
async function render(props = {}) { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); act(() => root.render(<CertificateRegister {...props} />)); await settle(); }
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); listCertificateRegister.mockReset(); });

describe('Certificate Register', () => {
  it('shows stored zero separately from unavailable and opens the exact certificate accessibly', async () => {
    listCertificateRegister.mockResolvedValue(payload); const onOpenCertificate = vi.fn(); await render({ onOpenCertificate });
    expect(container.textContent).toContain('£0.00'); expect(container.textContent).toContain('Unavailable');
    const open = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Open');
    expect(open.getAttribute('aria-label')).toContain('Certificate 2, Groundworks Ltd, Groundworks, Oak Meadow');
    act(() => open.click());
    expect(onOpenCertificate).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', orderKey: 'd1::s1::100' }), expect.objectContaining({ sort: 'newest', page: 1 }));
  });
  it('combines server filters and provides honest filtered no-results', async () => {
    listCertificateRegister.mockResolvedValueOnce(payload).mockResolvedValueOnce({ ...payload, total: 0, items: [] }); await render();
    const selects = container.querySelectorAll('select');
    act(() => { selects[2].value = 'submitted'; selects[2].dispatchEvent(new Event('change', { bubbles: true })); }); await settle();
    expect(listCertificateRegister).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'submitted', page: 1, pageSize: 25 }));
    expect(container.textContent).toContain('No certificates match');
  });
  it('distinguishes an empty company register', async () => {
    listCertificateRegister.mockResolvedValue({ ...payload, total: 0, items: [], options: { developments: [], suppliers: [] } }); await render();
    expect(container.textContent).toContain('No certificates exist for the selected company.');
  });
  it('shows a bounded error instead of stale commercial rows', async () => {
    listCertificateRegister.mockRejectedValue(new Error('Register unavailable')); await render();
    expect(container.querySelector('[role="alert"]').textContent).toContain('Register unavailable');
    expect(container.querySelector('table')).toBeNull();
  });
  it('clears tenant-specific selectors that are invalid after company switching', async () => {
    const onStateChange = vi.fn();
    listCertificateRegister.mockResolvedValue({ ...payload, total: 0, items: [], options: { developments: [{ id: 'new-dev', label: 'New Company' }], suppliers: [] } });
    await render({ initialState: { search: '', developmentId: 'old-dev', supplierId: 'old-supplier', status: '', sort: 'newest', page: 3 }, onStateChange });
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ search: '', developmentId: '', supplierId: '', page: 1 }));
  });
});
