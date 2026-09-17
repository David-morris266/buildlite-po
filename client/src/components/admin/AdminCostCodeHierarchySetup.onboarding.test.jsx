/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCostCodeHierarchySetup from './AdminCostCodeHierarchySetup';
import { applyCostCodeHierarchyWorksheet, getCostCodeOnboardingSummary, previewCostCodeHierarchyWorksheet } from '../../api/costCodes';
import { parseHierarchyWorksheet } from '../../admin/costCodeHierarchyWorksheet';
import { invalidateCostCodes, refreshCostCodes } from '../../admin/costCodeServerCache';

const HEAD_ID = '11111111-1111-4111-8111-111111111110';
const GROUP_ID = '11111111-1111-4111-8111-111111111120';

vi.mock('../../api/costCodes', () => ({ getCostCodeOnboardingSummary: vi.fn(), getCostCodeHierarchyWorksheet: vi.fn(), previewCostCodeHierarchyWorksheet: vi.fn(), applyCostCodeHierarchyWorksheet: vi.fn() }));
vi.mock('../../admin/costCodeHierarchyWorksheet', () => ({ downloadHierarchyWorksheet: vi.fn(), parseHierarchyWorksheet: vi.fn() }));
vi.mock('../../admin/costCodeServerCache', () => ({ invalidateCostCodes: vi.fn(), refreshCostCodes: vi.fn() }));
vi.mock('../../admin/costCodeServerMutations', () => ({ bulkUpdateCostCodeHierarchyOnServer: vi.fn() }));
vi.mock('../../admin/commercialStructureService', async () => {
  const actual = await vi.importActual('../../admin/commercialStructureService');
  return {
    ...actual,
    loadCommercialStructure: vi.fn(async () => ({
      heads: [{ id: HEAD_ID, name: 'Land', active: true, version: 1, displayOrder: 0 }],
      families: [],
      reportingGroups: [{ id: GROUP_ID, headId: HEAD_ID, familyId: null, name: 'Land Cost', active: true, version: 1, displayOrder: 0 }],
      adoptionIssues: [],
    })),
  };
});

const records = [
  { id: 'allocated', version: 1, code: '1100', description: 'Land Cost', active: true, commercialHeadId: HEAD_ID, reportingGroupId: GROUP_ID, hierarchyReviewState: 'allocated' },
  { id: 'review', version: 1, code: '1110', description: 'Legal Fees', active: true, hierarchyReviewState: 'not_reviewed' },
  { id: 'invalid', version: 1, code: '1120', description: 'Survey Fees', active: true, commercialHeadId: HEAD_ID, reportingGroupId: 'archived-or-invalid', hierarchyReviewState: 'needs_attention' },
  { id: 'inactive', version: 1, code: 'UATC02', description: 'Retained UAT identity', active: false, hierarchyReviewState: 'not_reviewed' },
];

let container;
let root;
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('Cost Code onboarding state convergence', () => {
  beforeEach(() => {
    getCostCodeOnboardingSummary.mockResolvedValue({ total: 3, allocated: 1, notReviewed: 1, notApplicable: 0, needsAttention: 1 });
    refreshCostCodes.mockResolvedValue([]);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('uses the authoritative active-only summary and partitions filtered selection by server state', async () => {
    await act(async () => root.render(<AdminCostCodeHierarchySetup records={records} />));
    await settle();

    expect(container.textContent).toContain('3 active · 1 Allocated · 1 Not reviewed · 0 Not applicable · 1 Needs attention');
    expect(container.textContent).not.toContain('Â·');
    expect(container.textContent).not.toContain('Ã‚Â·');
    expect(container.textContent).toContain('1110');
    expect(container.textContent).not.toContain('1100');
    expect(container.textContent).not.toContain('UATC02');
    expect([...container.querySelectorAll('button')].find((node) => node.textContent.includes('Select all filtered')).textContent).toContain('(1)');

    const filter = container.querySelector('[aria-label="Show cost codes"]');
    await act(async () => {
      filter.value = 'needs_attention';
      filter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('1120');
    expect(container.textContent).not.toContain('1110');
    expect(container.textContent).not.toContain('UATC02');
  });

  it('previews before applying and refreshes authoritative caches only after success', async () => {
    const worksheetRows = [{ id: 'review', code: '1110', description: 'Legal Fees', version: 1, commercialHead: 'Professional Fees', reportingGroup: 'Legal Fees' }];
    parseHierarchyWorksheet.mockResolvedValue(worksheetRows);
    previewCostCodeHierarchyWorksheet.mockResolvedValue({ preview: { catalogueRevision: 'revision', reviewToken: 'token', proposals: [], rows: [{ ...worksheetRows[0], action: 'allocate', before: { state: 'not_reviewed', labels: {} }, after: { labels: { commercialHead: 'Professional Fees', commercialFamily: '', reportingGroup: 'Legal Fees' } } }], summary: { rowsReviewed: 1, allocations: 1, notApplicable: 0, unchanged: 0, blockers: 0, existingPathsMatched: 0, newHeads: 1, newFamilies: 0, newReportingGroups: 1 } } });
    applyCostCodeHierarchyWorksheet.mockResolvedValue({ summary: { updated: 1 } });
    await act(async () => root.render(<AdminCostCodeHierarchySetup records={records} />)); await settle();
    const input = container.querySelector('[aria-label="Completed hierarchy mapping worksheet"]');
    const file = new File(['workbook'], 'mapping.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); await settle();
    expect(container.textContent).toContain('Review mapping worksheet');
    expect(applyCostCodeHierarchyWorksheet).not.toHaveBeenCalled();
    const apply = [...container.querySelectorAll('button')].find((node) => node.textContent.includes('Apply reviewed mapping'));
    await act(async () => apply.click()); await settle();
    expect(applyCostCodeHierarchyWorksheet).toHaveBeenCalledWith({ rows: worksheetRows, sourceFilename: 'mapping.xlsx', catalogueRevision: 'revision', reviewToken: 'token' });
    expect(invalidateCostCodes).toHaveBeenCalledOnce(); expect(refreshCostCodes).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Mapping applied.');
  });
});
