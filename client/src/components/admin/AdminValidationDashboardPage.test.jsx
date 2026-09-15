/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ records: [], structure: vi.fn(), ready: vi.fn(), listPos: vi.fn() }));
vi.mock('../../api', () => ({ listPOs: mocks.listPos }));
vi.mock('../../admin/commercialStructureService', () => ({ loadCommercialStructure: mocks.structure }));
vi.mock('../../admin/costCodeAdminService', () => ({
  ensureAdminCostCodesReady: mocks.ready,
  listAdminCostCodeRecords: () => mocks.records,
}));
import AdminValidationDashboardPage from './AdminValidationDashboardPage';

let container;
let root;
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('AdminValidationDashboardPage affected records', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.listPos.mockReset().mockResolvedValue({ items: [] });
    mocks.ready.mockReset().mockResolvedValue([]);
    mocks.structure.mockReset().mockResolvedValue({ heads: [], families: [], reportingGroups: [] });
    mocks.records = [{ id: 'legacy-id', code: 'LEGACY', commercialHead: 'Old', trade: 'Old group', active: true }];
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('passes issue identity and affected Cost Codes to the review destination', async () => {
    const navigate = vi.fn();
    await act(async () => root.render(<AdminValidationDashboardPage onNavigate={navigate} />));
    await settle();
    expect(container.textContent).toContain('Hierarchy requires review');
    expect(container.textContent).not.toContain('Missing Trade');
    act(() => [...container.querySelectorAll('button')].find((item) => item.textContent.includes('Review affected records')).click());
    expect(navigate).toHaveBeenCalledWith('cost-codes', {
      issueId: 'unresolved-hierarchy', label: 'Hierarchy requires review', records: [{ id: 'legacy-id', code: 'LEGACY' }],
    });
  });
});
