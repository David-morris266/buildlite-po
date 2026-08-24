/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const previewDevelopmentPrelimsSetup = vi.hoisted(() => vi.fn());
const applyDevelopmentPrelimsSetup = vi.hoisted(() => vi.fn());
const listPrelimsTemplates = vi.hoisted(() => vi.fn());
const listCostCodesForTemplateMapping = vi.hoisted(() => vi.fn());
const getCostCodeClassification = vi.hoisted(() => vi.fn());
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

import DevelopmentPrelimsSetupWorksheet from './DevelopmentPrelimsSetupWorksheet';

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
    const search = container.querySelector(`[aria-label="${lineName} cost code search"]`);
    await act(async () => {
      search.focus();
      setInputValue(search, code);
    });
    await act(async () => {
      const option = container.querySelector(
        `[aria-label="${lineName} cost code options"] [data-cost-code="${code}"]`
      );
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
  }

  async function renderSheet() {
    await act(async () => {
      root.render(
        <DevelopmentPrelimsSetupWorksheet
          developmentId="dev-1"
          onCancel={() => {}}
          onApplied={() => {}}
        />
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
        code: '5210',
        description: 'Site management',
        reportingGroup: 'Prelim & Supervision Costs - 53',
      },
      {
        code: '5231',
        description: 'Ongoing site cleaning',
        reportingGroup: 'Prelim & Supervision Costs - 53',
      },
      {
        code: '5305',
        description: 'Supervision / Management',
        reportingGroup: 'Prelim & Supervision Costs - 53',
      },
      {
        code: 'UAT-CC-001',
        description: 'Test Site custom prelims',
        reportingGroup: 'Prelims',
      },
    ]);
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

    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Site Manager monthly rate"]'), '5500');
    });
    expect(container.textContent).toMatch(/£209,000/);
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
      btn.textContent.includes('Create selected lines')
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
  });

  it('filters cost codes by canonical code, description, partial text, and restores on clear', async () => {
    await renderSheet();
    const lineName = 'BL-033D.x.2 CUSTOM UAT';
    const searchInput = container.querySelector(`[aria-label="${lineName} cost code search"]`);

    await act(async () => {
      searchInput.focus();
      setInputValue(searchInput, '5305');
    });
    let menu = container.querySelector(`[aria-label="${lineName} cost code options"]`);
    expect(menu.textContent).toMatch(/5305 — Supervision \/ Management/i);
    expect(menu.textContent).not.toMatch(/5210 — Site management/i);

    await act(async () => {
      setInputValue(searchInput, 'SUPERVISION');
    });
    menu = container.querySelector(`[aria-label="${lineName} cost code options"]`);
    expect(menu.textContent).toMatch(/5305 — Supervision \/ Management/i);
    expect(menu.textContent).not.toMatch(/5210 — Site management/i);
    expect(menu.textContent).not.toMatch(/5231 — Ongoing site cleaning/i);
    expect(menu.querySelector('.dev-prelims-setup__cost-code-secondary')?.textContent).toMatch(
      /Prelim & Supervision Costs - 53/
    );

    await act(async () => {
      setInputValue(searchInput, 'custom prelims');
    });
    menu = container.querySelector(`[aria-label="${lineName} cost code options"]`);
    expect(menu.textContent).toMatch(/UAT-CC-001 — Test Site custom prelims/i);
    expect(menu.textContent).not.toMatch(/5305 — Supervision \/ Management/i);

    await act(async () => {
      setInputValue(searchInput, '');
    });
    menu = container.querySelector(`[aria-label="${lineName} cost code options"]`);
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
      const option = container.querySelector(
        `[aria-label="${lineName} cost code options"] [data-cost-code="5231"]`
      );
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Site Manager monthly rate"]'), '5500');
      setInputValue(container.querySelector(`[aria-label="${lineName} lump-sum amount"]`), '250');
      container.querySelector(`[aria-label="Select ${lineName}"]`).click();
    });

    const selected = container.querySelector(`[aria-label="${lineName} cost code"]`);
    expect(selected.getAttribute('data-cost-code')).toBe('5231');
    expect(container.textContent).toMatch(/PRELIMS/);
    expect(container.textContent).toMatch(/Overlap · 1 existing line/);

    const createBtn = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('Create selected lines')
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
      btn.textContent.includes('Create selected lines')
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
      btn.textContent.includes('Create selected lines')
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
