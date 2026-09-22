/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const previewDevelopmentPrelimsSetup = vi.hoisted(() => vi.fn());
const applyDevelopmentPrelimsSetup = vi.hoisted(() => vi.fn());
const listPrelimsTemplates = vi.hoisted(() => vi.fn());
const listCostCodesForTemplateMapping = vi.hoisted(() => vi.fn());
const getCostCodeClassification = vi.hoisted(() => vi.fn());
const loadCommercialStructure = vi.hoisted(() => vi.fn());
const PrelimsApiError = vi.hoisted(() => {
  return class DevelopmentPrelimsApiError extends Error {
    constructor(message, { status = 0 } = {}) {
      super(message);
      this.name = 'DevelopmentPrelimsApiError';
      this.status = status;
    }
  };
});

vi.mock('../api/developmentPrelimsItems', () => ({
  previewDevelopmentPrelimsSetup,
  applyDevelopmentPrelimsSetup,
  DevelopmentPrelimsApiError: PrelimsApiError,
}));

vi.mock('../api/prelimsTemplates', () => ({
  listPrelimsTemplates,
}));

vi.mock('../admin/prelimsTemplateCostCodes', () => ({
  listCostCodesForTemplateMapping,
}));

vi.mock('../api/costCodeClassifications', () => ({
  getCostCodeClassification,
}));
vi.mock('../admin/commercialStructureService', () => ({ loadCommercialStructure }));

import DevelopmentPrelimsSetupWorksheet from './DevelopmentPrelimsSetupWorksheet';
import { UnsavedChangesProvider } from '../navigation/UnsavedChangesProvider.jsx';

function previewBody() {
  return {
    developmentId: 'dev-1',
    template: { id: 'tmpl-1', name: 'BuildLite Standard Prelims', version: 1, isDefault: true },
    reportingMonth: '2026-08',
    programme: {
      exists: true,
      siteStart: '2026-09-01',
      firstCompletion: null,
      finalCompletion: '2029-10-01',
    },
    existingItems: [{ id: 'd1', name: 'BL-033D.1 TIME UAT', costCodeKey: '5231' }],
    lines: [
      {
        templateLineId: 'sm',
        templateKey: 'bl.prelims.v1.site_manager',
        name: 'Site Manager',
        guidance: 'Full-time site management',
        forecastDriver: 'TIME',
        startBasis: 'SITE_START',
        endBasis: 'FINAL_COMPLETION',
        costCodeKey: '5210',
        enabled: true,
        alreadyApplied: false,
        selectable: true,
        defaultSelected: true,
        overlap: false,
        classification: { tone: 'unmapped', message: null },
        duration: { state: 'resolved', totalMonths: 38 },
      },
      {
        templateLineId: 'clean',
        templateKey: 'bl.prelims.v1.cleaning_ongoing',
        name: 'Ongoing Site Cleaning',
        guidance: 'Keep the site tidy',
        forecastDriver: 'TIME',
        startBasis: 'SITE_START',
        endBasis: 'FINAL_COMPLETION',
        costCodeKey: '5231',
        enabled: true,
        alreadyApplied: false,
        selectable: true,
        defaultSelected: false,
        overlap: true,
        overlapExistingNames: ['BL-033D.1 TIME UAT'],
        classification: { tone: 'normal', semanticGroup: 'PRELIMS' },
        duration: { state: 'resolved', totalMonths: 38 },
      },
      {
        templateLineId: 'security',
        templateKey: 'bl.prelims.v1.security',
        name: 'Security manning',
        forecastDriver: 'TIME',
        startBasis: 'SITE_START',
        endBasis: 'FINAL_COMPLETION',
        costCodeKey: null,
        enabled: true,
        alreadyApplied: false,
        selectable: true,
        defaultSelected: false,
        overlap: false,
        classification: { tone: 'unmapped' },
        duration: { state: 'resolved', totalMonths: 38 },
      },
      {
        templateLineId: 'custom',
        templateKey: 'co.prelims.abc',
        name: 'BL-033D.x.2 CUSTOM UAT',
        forecastDriver: 'LUMP_SUM',
        costCodeKey: null,
        enabled: true,
        alreadyApplied: false,
        selectable: true,
        defaultSelected: false,
        overlap: false,
        classification: { tone: 'unmapped' },
        duration: { state: 'resolved', totalMonths: null },
      },
      {
        templateLineId: 'disabled',
        templateKey: 'bl.prelims.v1.disabled',
        name: 'Disabled welfare',
        forecastDriver: 'LUMP_SUM',
        costCodeKey: '5210',
        enabled: false,
        alreadyApplied: false,
        selectable: false,
        defaultSelected: false,
        classification: { tone: 'normal' },
      },
    ],
  };
}

function setInputValue(element, value) {
  const proto =
    element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const native = Object.getOwnPropertyDescriptor(proto, 'value').set;
  native.call(element, value);
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

describe('Development Prelims setup worksheet', () => {
  let container;
  let root;

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function chooseCostCode(lineName, code) {
    let search = container.querySelector(`[aria-label="${lineName} cost code search"]`);
    if (!search) {
      const row = Array.from(container.querySelectorAll('.dev-prelims-setup__primary')).find((item) =>
        item.textContent.includes(lineName)
      );
      const change = Array.from(row.querySelectorAll('button')).find((button) =>
        button.textContent.includes('Change')
      );
      await act(async () => change.click());
      search = container.querySelector(`[aria-label="${lineName} cost code search"]`);
    }
    await act(async () => {
      search.focus();
      setInputValue(search, code);
    });
    await act(async () => {
      const option = document.body.querySelector(
        `[aria-label="${lineName} cost code options"] [data-cost-code="${code}"]`
      );
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
  }

  async function renderSheet({ onCancel = () => {}, onApplied = () => {} } = {}) {
    await act(async () => {
      root.render(
        <UnsavedChangesProvider>
          <DevelopmentPrelimsSetupWorksheet
            developmentId="dev-1"
            onCancel={onCancel}
            onApplied={onApplied}
          />
        </UnsavedChangesProvider>
      );
    });
    await flush();
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listPrelimsTemplates.mockResolvedValue({
      templates: [{ id: 'tmpl-1', name: 'BuildLite Standard Prelims', isDefault: true }],
    });
    previewDevelopmentPrelimsSetup.mockResolvedValue(previewBody());
    applyDevelopmentPrelimsSetup.mockResolvedValue({ createdCount: 1, skippedCount: 0, created: [] });
    listCostCodesForTemplateMapping.mockResolvedValue([
      {
        id: 'cc-5210', active: true, commercialHeadId: 'prelims',
        code: '5210',
        description: 'Site management',
        reportingGroup: 'Prelim & Supervision Costs - 53',
      },
      {
        id: 'cc-5231', active: true, commercialHeadId: 'prelims',
        code: '5231',
        description: 'Ongoing site cleaning',
        reportingGroup: 'Prelim & Supervision Costs - 53',
      },
      {
        id: 'cc-5305', active: true, commercialHeadId: 'prelims',
        code: '5305',
        description: 'Supervision / Management',
        reportingGroup: 'Prelim & Supervision Costs - 53',
      },
      {
        id: 'cc-uat', active: true, commercialHeadId: 'prelims',
        code: 'UAT-CC-001',
        description: 'Test Site custom prelims',
        reportingGroup: 'Prelims',
      },
    ]);
    loadCommercialStructure.mockResolvedValue({heads:[{id:'prelims',name:'Preliminaries',buildliteCategory:'PRELIMINARIES',active:true}],families:[],reportingGroups:[]});
    getCostCodeClassification.mockImplementation(async (key) => {
      if (key === '5231') return { semanticGroup: 'PRELIMS', exists: true };
      if (key === '5305') return { semanticGroup: 'UNCLASSIFIED', exists: false };
      return { semanticGroup: 'UNCLASSIFIED', exists: false };
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it('renders a commercial setup worksheet and live TIME forecast', async () => {
    await renderSheet();
    expect(container.textContent).toMatch(/Prelims setup worksheet/);
    expect(container.textContent).toMatch(/Site Manager/);
    expect(container.textContent).toMatch(/Full-time site management/);
    expect(container.textContent).toMatch(/38 months/);
    expect(container.textContent).not.toMatch(/Review & Adopt/);
    expect(container.querySelector('[aria-label="Site Manager line detail"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Site Manager start basis"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="BL-033D.x.2 CUSTOM UAT start basis"]')).toBeNull();
    expect(container.textContent).toContain('Company mapping');
    expect(container.textContent).toContain('Company template unmapped');
    expect(container.textContent).toContain('complete the reusable company mapping in Administration');
    expect(container.querySelector('[aria-label="Site Manager cost code search"]')).toBeNull();
    expect(container.querySelector('[aria-label="Site Manager cost code"]')).toBeNull();
    expect(container.textContent).toContain('5210 — Site management');
    expect(
      container.querySelector('[aria-label="Site Manager forecast driver"] option:checked').textContent
    ).toBe('Time based');
    expect(
      container.querySelector('[aria-label="Site Manager start basis"] option:checked').textContent
    ).toBe('Site start');
    expect(
      container.querySelector('[aria-label="Site Manager end basis"] option:checked').textContent
    ).toBe('Final completion');

    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Site Manager monthly rate"]'), '5500');
    });
    expect(container.textContent).toMatch(/£209,000/);
  });

  it('labels a site-specific Cost Code change as a development override without writing the template', async () => {
    await renderSheet();
    await chooseCostCode('Site Manager', '5231');
    expect(container.textContent).toContain('Development override');
    expect(container.textContent).toContain(
      'This site has selected a different Cost Code from the company template.'
    );
    expect(applyDevelopmentPrelimsSetup).not.toHaveBeenCalled();

    const row = Array.from(container.querySelectorAll('.dev-prelims-setup__primary')).find((item) =>
      item.textContent.includes('Site Manager')
    );
    const revert = Array.from(row.querySelectorAll('button')).find((button) =>
      button.textContent.includes('Revert to company mapping')
    );
    await act(async () => revert.click());
    expect(row.textContent).toContain('Company mapping');
    expect(row.textContent).toContain('5210 — Site management');
  });

  it('cancels an inherited mapping change without creating an override', async () => {
    await renderSheet();
    const row = Array.from(container.querySelectorAll('.dev-prelims-setup__primary')).find((item) =>
      item.textContent.includes('Site Manager')
    );
    const change = Array.from(row.querySelectorAll('button')).find((button) =>
      button.textContent.includes('Change for this development')
    );
    await act(async () => change.click());
    expect(container.querySelector('[aria-label="Site Manager cost code search"]')).toBeTruthy();
    const cancel = Array.from(row.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Cancel'
    );
    await act(async () => cancel.click());
    expect(container.querySelector('[aria-label="Site Manager cost code search"]')).toBeNull();
    expect(row.textContent).toContain('Company mapping');
    expect(applyDevelopmentPrelimsSetup).not.toHaveBeenCalled();
  });

  it('uses a bounded laptop-width reflow instead of compressing primary controls', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../styles/po-module.css'),
      'utf8'
    );
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.dev-prelims-setup__primary/);
    expect(css).toMatch(
      /\.dev-prelims-setup__primary td::before\s*\{[\s\S]*content: attr\(data-label\)/
    );
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*dev-prelims-setup__primary/);
  });

  it('creates only selected ready lines once, including a preview-only mapped custom line', async () => {
    await renderSheet();
    const customName = 'BL-033D.x.2 CUSTOM UAT';
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Site Manager monthly rate"]'), '5500');
    });
    await chooseCostCode(customName, 'UAT-CC-001');
    await act(async () => {
      setInputValue(container.querySelector(`[aria-label="${customName} lump-sum amount"]`), '250');
      container.querySelector(`[aria-label="Select ${customName}"]`).click();
    });
    const createBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('to Site Prelims')
    );
    await act(async () => {
      createBtn.click();
      createBtn.click();
      await Promise.resolve();
    });
    expect(applyDevelopmentPrelimsSetup).toHaveBeenCalledTimes(1);
    const payload = applyDevelopmentPrelimsSetup.mock.calls[0][1];
    expect(payload.templateId).toBe('tmpl-1');
    expect(payload.templateVersion).toBe(1);
    expect(payload.lines).toHaveLength(2);
    expect(payload.lines.find((row) => row.templateLineId === 'sm').monthlyRate).toBe(5500);
    expect(payload.lines.find((row) => row.templateLineId === 'custom').costCodeKey).toBe('UAT-CC-001');
    expect(payload.lines.find((row) => row.templateLineId === 'clean')).toBeUndefined();
    expect(container.textContent).toContain('Development Prelims proposal');
    expect(container.textContent).toContain('This does not change the CVR');
  });

  it('keeps the worksheet open and preserves unfinished rows across incremental Adds', async () => {
    const initial = previewBody();
    const afterSiteManager = previewBody();
    afterSiteManager.lines[0] = {
      ...afterSiteManager.lines[0],
      alreadyApplied: true,
      selectable: false,
      defaultSelected: false,
    };
    const afterBoth = structuredClone(afterSiteManager);
    afterBoth.lines[3] = {
      ...afterBoth.lines[3],
      alreadyApplied: true,
      selectable: false,
      defaultSelected: false,
    };
    previewDevelopmentPrelimsSetup.mockReset();
    previewDevelopmentPrelimsSetup
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(afterSiteManager)
      .mockResolvedValueOnce(afterBoth);
    applyDevelopmentPrelimsSetup
      .mockResolvedValueOnce({ createdCount: 1, created: [{ templateKey: initial.lines[0].templateKey }] })
      .mockResolvedValueOnce({ createdCount: 1, created: [{ templateKey: initial.lines[3].templateKey }] });

    await renderSheet();
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Site Manager monthly rate"]'), '5500');
    });
    await chooseCostCode('BL-033D.x.2 CUSTOM UAT', 'UAT-CC-001');
    await act(async () => {
      container.querySelector('[aria-label="Select BL-033D.x.2 CUSTOM UAT"]').click();
    });
    expect(container.textContent).toContain('2 selected');
    expect(container.textContent).toContain('1 needs attention');

    const add = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes('Add 1 ready line to Site Prelims')
    );
    await act(async () => {
      add.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Already on this development');
    expect(container.querySelector('[aria-label="Prelims setup worksheet"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="BL-033D.x.2 CUSTOM UAT cost code search"]')?.getAttribute('data-cost-code')).toBe('UAT-CC-001');
    expect(container.querySelector('[aria-label="Select BL-033D.x.2 CUSTOM UAT"]').checked).toBe(true);
    expect(document.body.textContent).toContain('0 ready');
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Cancel').click();
    });
    expect(document.body.textContent).toContain('Unsaved Prelims setup');
    await act(async () => {
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Stay').click();
    });

    await act(async () => {
      setInputValue(
        container.querySelector('[aria-label="BL-033D.x.2 CUSTOM UAT lump-sum amount"]'),
        '250'
      );
    });
    const addLater = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes('Add 1 ready line to Site Prelims')
    );
    await act(async () => {
      addLater.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(applyDevelopmentPrelimsSetup).toHaveBeenCalledTimes(2);
    expect(applyDevelopmentPrelimsSetup.mock.calls[0][1].lines.map((row) => row.templateLineId)).toEqual(['sm']);
    expect(applyDevelopmentPrelimsSetup.mock.calls[1][1].lines.map((row) => row.templateLineId)).toEqual(['custom']);
  });

  it('warns on dirty Cancel, keeps state on Stay, and leaves only after confirmation', async () => {
    const onCancel = vi.fn();
    await renderSheet({ onCancel });
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Site Manager monthly rate"]'), '5500');
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Cancel').click();
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Unsaved Prelims setup');
    await act(async () => {
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Stay').click();
    });
    expect(container.querySelector('[aria-label="Site Manager monthly rate"]').value).toBe('5500');
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Cancel').click();
    });
    await act(async () => {
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Leave without saving').click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('registers beforeunload only while meaningful setup remains dirty', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const after = previewBody();
    after.lines[0] = { ...after.lines[0], alreadyApplied: true, selectable: false, defaultSelected: false };
    previewDevelopmentPrelimsSetup.mockReset();
    previewDevelopmentPrelimsSetup.mockResolvedValueOnce(previewBody()).mockResolvedValueOnce(after);
    await renderSheet();
    expect(addSpy.mock.calls.some(([type]) => type === 'beforeunload')).toBe(false);
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Site Manager monthly rate"]'), '5500');
    });
    expect(addSpy.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true);
    const add = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent.includes('to Site Prelims')
    );
    await act(async () => {
      add.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(removeSpy.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('reloads persisted proposal checkpoints and newly configured company mappings on return', async () => {
    const afterAdd = previewBody();
    afterAdd.lines[0] = { ...afterAdd.lines[0], alreadyApplied: true, selectable: false, defaultSelected: false };
    const afterAdministration = structuredClone(afterAdd);
    afterAdministration.lines[3] = {
      ...afterAdministration.lines[3],
      costCodeKey: '5305',
      defaultSelected: true,
      classification: { tone: 'normal', semanticGroup: 'PRELIMS' },
    };
    previewDevelopmentPrelimsSetup.mockReset();
    previewDevelopmentPrelimsSetup
      .mockResolvedValueOnce(previewBody())
      .mockResolvedValueOnce(afterAdd)
      .mockResolvedValueOnce(afterAdministration);
    await renderSheet();
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Site Manager monthly rate"]'), '5500');
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('to Site Prelims')).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Already on this development');

    await act(async () => root.render(null));
    await renderSheet();
    expect(container.textContent).toContain('Already on this development');
    expect(container.textContent).toContain('5305 — Supervision / Management');
    expect(container.textContent).toContain('Company mapping');
  });

  it('filters cost codes by canonical code, description, partial text, and restores on clear', async () => {
    await renderSheet();
    const lineName = 'BL-033D.x.2 CUSTOM UAT';
    const searchInput = container.querySelector(`[aria-label="${lineName} cost code search"]`);

    await act(async () => {
      searchInput.focus();
      setInputValue(searchInput, '5305');
    });
    let menu = document.body.querySelector(`[aria-label="${lineName} cost code options"]`);
    expect(menu.textContent).toMatch(/5305 — Supervision \/ Management/i);
    expect(menu.textContent).not.toMatch(/5210 — Site management/i);

    await act(async () => {
      setInputValue(searchInput, 'SUPERVISION');
    });
    menu = document.body.querySelector(`[aria-label="${lineName} cost code options"]`);
    expect(menu.textContent).toMatch(/5305 — Supervision \/ Management/i);
    expect(menu.textContent).not.toMatch(/5210 — Site management/i);
    expect(menu.textContent).not.toMatch(/5231 — Ongoing site cleaning/i);
    expect(menu.querySelector('.dev-prelims-setup__cost-code-secondary')?.textContent).toMatch(/Preliminaries/);

    await act(async () => {
      setInputValue(searchInput, 'custom prelims');
    });
    menu = document.body.querySelector(`[aria-label="${lineName} cost code options"]`);
    expect(menu.textContent).toMatch(/UAT-CC-001 — Test Site custom prelims/i);
    expect(menu.textContent).not.toMatch(/5305 — Supervision \/ Management/i);

    await act(async () => {
      setInputValue(searchInput, '');
    });
    menu = document.body.querySelector(`[aria-label="${lineName} cost code options"]`);
    expect(menu.textContent).toMatch(/5210 — Site management/i);
    expect(menu.textContent).toMatch(/5305 — Supervision \/ Management/i);
    expect(menu.textContent).toMatch(/UAT-CC-001 — Test Site custom prelims/i);
  });

  it('persists canonical code and keeps classification/overlap semantics compact', async () => {
    await renderSheet();
    const lineName = 'BL-033D.x.2 CUSTOM UAT';
    await act(async () => {
      const searchInput = container.querySelector(`[aria-label="${lineName} cost code search"]`);
      searchInput.focus();
      setInputValue(searchInput, 'ongoing site cleaning');
    });
    await act(async () => {
      const option = document.body.querySelector(
        `[aria-label="${lineName} cost code options"] [data-cost-code="5231"]`
      );
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Site Manager monthly rate"]'), '5500');
      setInputValue(container.querySelector(`[aria-label="${lineName} lump-sum amount"]`), '250');
      container.querySelector(`[aria-label="Select ${lineName}"]`).click();
    });

    const selected = container.querySelector(`[aria-label="${lineName} cost code search"]`);
    expect(selected.getAttribute('data-cost-code')).toBe('5231');
    expect(container.textContent).toMatch(/PRELIMS/);
    expect(container.textContent).toMatch(/Overlap · 1 existing line/);

    const createBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('to Site Prelims')
    );
    await act(async () => {
      createBtn.click();
      await Promise.resolve();
    });
    const payload = applyDevelopmentPrelimsSetup.mock.calls[0][1];
    expect(payload.lines.find((row) => row.templateLineId === 'custom').costCodeKey).toBe('5231');
  });

  it('allows template TIME to become development LUMP_SUM and persists that driver', async () => {
    await renderSheet();
    const lineName = 'Security manning';
    await act(async () => {
      setInputValue(container.querySelector(`[aria-label="${lineName} forecast driver"]`), 'LUMP_SUM');
    });
    expect(container.querySelector(`[aria-label="${lineName} monthly rate"]`)).toBeNull();
    expect(container.querySelector(`[aria-label="${lineName} lump-sum amount"]`)).toBeTruthy();
    expect(container.querySelector(`[aria-label="${lineName} start basis"]`)).toBeNull();

    await chooseCostCode(lineName, '5305');
    await act(async () => {
      setInputValue(container.querySelector(`[aria-label="${lineName} lump-sum amount"]`), '75000');
      container.querySelector(`[aria-label="Select ${lineName}"]`).click();
    });

    expect(container.textContent).toMatch(/£75,000/);
    expect(container.textContent).toMatch(/UNCLASSIFIED/);
    expect(container.textContent).toMatch(/Expected PRELIMS/);

    const createBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('to Site Prelims')
    );
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Site Manager monthly rate"]'), '5500');
      createBtn.click();
      await Promise.resolve();
    });
    const payload = applyDevelopmentPrelimsSetup.mock.calls[0][1];
    const security = payload.lines.find((row) => row.templateLineId === 'security');
    expect(security.forecastDriver).toBe('LUMP_SUM');
    expect(security.lumpSumAmount).toBe(75000);
    expect(security.monthlyRate).toBeNull();
    expect(security.startBasis).toBeNull();
  });

  it('allows template LUMP_SUM to become development TIME', async () => {
    await renderSheet();
    const lineName = 'BL-033D.x.2 CUSTOM UAT';
    await act(async () => {
      setInputValue(container.querySelector(`[aria-label="${lineName} forecast driver"]`), 'TIME');
    });
    expect(container.querySelector(`[aria-label="${lineName} lump-sum amount"]`)).toBeNull();
    expect(container.querySelector(`[aria-label="${lineName} monthly rate"]`)).toBeTruthy();
    expect(container.querySelector(`[aria-label="${lineName} start basis"]`)).toBeTruthy();
    expect(container.querySelector(`[aria-label="${lineName} line detail"]`)).toBeTruthy();

    await chooseCostCode(lineName, '5210');
    await act(async () => {
      setInputValue(container.querySelector(`[aria-label="${lineName} monthly rate"]`), '1000');
      container.querySelector(`[aria-label="Select ${lineName}"]`).click();
      setInputValue(container.querySelector('[aria-label="Site Manager monthly rate"]'), '5500');
    });

    const createBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('to Site Prelims')
    );
    await act(async () => {
      createBtn.click();
      await Promise.resolve();
    });
    const payload = applyDevelopmentPrelimsSetup.mock.calls[0][1];
    const custom = payload.lines.find((row) => row.templateLineId === 'custom');
    expect(custom.forecastDriver).toBe('TIME');
    expect(custom.monthlyRate).toBe(1000);
    expect(custom.lumpSumAmount).toBeNull();
    expect(custom.startBasis).toBe('SITE_START');
    expect(custom.endBasis).toBe('FINAL_COMPLETION');
  });
});
