/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ structure: vi.fn(), ready: vi.fn(), records: [] }));
vi.mock('../../admin/commercialStructureService', () => ({ loadCommercialStructure: mocks.structure }));
vi.mock('../../admin/costCodeAdminService', () => ({
  ensureAdminCostCodesReady: mocks.ready,
  listAdminCostCodeRecords: () => mocks.records,
}));
vi.mock('../../admin/commercialBehaviourStore', () => ({
  getCommercialBehaviourSettings: (heads = []) => ({
    behaviours: Object.fromEntries(heads.map((head) => [head, { includeOnExecutiveSummary: true }])),
  }),
}));

import AdminReportingPreviewPage from './AdminReportingPreviewPage';

const structure = {
  heads: [
    { id: 'land', name: 'Land', active: true, displayOrder: 0 },
    { id: 'uat', name: 'UAT Test Costs', active: true, displayOrder: 1 },
    { id: 'build', name: 'House Build', active: true, displayOrder: 2 },
  ],
  families: [{ id: 'shell', headId: 'build', name: 'Shell', active: true, displayOrder: 0 }],
  reportingGroups: [
    { id: 'land-cost', headId: 'land', familyId: null, name: 'Land Cost', active: true, displayOrder: 0 },
    { id: 'uat-group', headId: 'uat', familyId: null, name: 'UAT Test Group', active: true, displayOrder: 0 },
    { id: 'brickwork', headId: 'build', familyId: 'shell', name: 'Brickwork', active: true, displayOrder: 0 },
  ],
};

let container;
let root;
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('AdminReportingPreviewPage authoritative hierarchy', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.structure.mockReset().mockResolvedValue(structure);
    mocks.ready.mockReset().mockResolvedValue([]);
    mocks.records = [
      { id: '1', code: 'UATC01', commercialHeadId: 'land', commercialFamilyId: null, reportingGroupId: 'land-cost', active: true },
      { id: '2', code: 'UATC02', commercialHeadId: null, commercialFamilyId: null, reportingGroupId: null, active: true },
      { id: '3', code: 'UATC03', commercialHeadId: 'uat', commercialFamilyId: null, reportingGroupId: 'uat-group', active: true },
      { id: '4', code: 'BRK', commercialHeadId: 'build', commercialFamilyId: 'shell', reportingGroupId: 'brickwork', active: true },
      { id: '5', code: 'OLD', commercialHeadId: 'land', commercialFamilyId: null, reportingGroupId: 'land-cost', active: false },
    ];
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders two- and three-level paths without inventing a Family and keeps master totals independent', async () => {
    await act(async () => root.render(<AdminReportingPreviewPage />));
    await settle();

    expect(container.textContent).toContain('Total Cost Codes5');
    expect(container.textContent).toContain('Land Cost1');
    expect(container.textContent).toContain('UAT Test Group1');
    expect(container.textContent).toContain('Shell');
    expect(container.textContent).toContain('Brickwork1');
    expect(container.textContent).not.toContain('No Family');
    expect(container.textContent).not.toContain('Unallocated');
    expect([...container.querySelectorAll('.admin-report-preview__head')][0].textContent).toContain('Land1 codes');
  });
});
