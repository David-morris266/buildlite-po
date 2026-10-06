/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ ensure: vi.fn(), create: vi.fn() }));
const auth = vi.hoisted(() => ({ markStale: vi.fn(), refreshReadiness: vi.fn() }));
vi.mock('../developments/developmentStore', () => ({
  DEVELOPMENT_STATUSES: [{ value: 'planning', label: 'Planning', modifier: 'planning' }],
  ensureDevelopmentsReady: (...args) => store.ensure(...args),
  createDevelopment: (...args) => store.create(...args),
}));
vi.mock('../admin/numberingService', () => ({ generateNextDevelopmentNumber: () => 'DEV-001' }));
vi.mock('../auth/BuildLiteAuthProvider', () => ({
  useBuildLitePrincipal: () => ({ markTenantReadinessStale: auth.markStale, refreshTenantReadiness: auth.refreshReadiness }),
}));

import DevelopmentForm from './DevelopmentForm';

describe('Development creation readiness convergence', () => {
  let container; let root;
  beforeEach(() => {
    store.ensure.mockResolvedValue([]);
    store.create.mockResolvedValue({ id: 'development-1' });
    auth.refreshReadiness.mockResolvedValue({});
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

  it('converges tenant readiness once after the first Development commits', async () => {
    const onCreated = vi.fn();
    await act(async () => { root.render(<DevelopmentForm onCreated={onCreated} />); await Promise.resolve(); await Promise.resolve(); });
    const developmentName = [...container.querySelectorAll('label')].find((label) => label.textContent.startsWith('Development Name')).querySelector('input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(developmentName, 'Pilot Development');
      developmentName.dispatchEvent(new Event('input', { bubbles: true }));
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve();
    });
    expect(store.create).toHaveBeenCalledOnce();
    expect(auth.markStale).toHaveBeenCalledOnce();
    expect(auth.refreshReadiness).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledWith('development-1', { readinessRefreshed: true });
  });

  it('does not invalidate readiness when Development creation fails', async () => {
    store.create.mockRejectedValue(new Error('Rejected'));
    await act(async () => { root.render(<DevelopmentForm />); await Promise.resolve(); await Promise.resolve(); });
    const developmentName = [...container.querySelectorAll('label')].find((label) => label.textContent.startsWith('Development Name')).querySelector('input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(developmentName, 'Pilot Development');
      developmentName.dispatchEvent(new Event('input', { bubbles: true }));
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve(); await Promise.resolve();
    });
    expect(container.textContent).toContain('Rejected');
    expect(auth.markStale).not.toHaveBeenCalled();
  });
});
