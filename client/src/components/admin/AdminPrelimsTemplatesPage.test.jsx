/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const listPrelimsTemplates = vi.hoisted(() => vi.fn());
const getPrelimsTemplate = vi.hoisted(() => vi.fn());
const createPrelimsTemplate = vi.hoisted(() => vi.fn());
const updatePrelimsTemplate = vi.hoisted(() => vi.fn());
const createPrelimsTemplateLine = vi.hoisted(() => vi.fn());
const updatePrelimsTemplateLine = vi.hoisted(() => vi.fn());
const listCostCodesForTemplateMapping = vi.hoisted(() => vi.fn());
const listCostCodeClassifications = vi.hoisted(() => vi.fn());
const loadCommercialStructure = vi.hoisted(() => vi.fn());

vi.mock('../../api/prelimsTemplates', () => ({
  listPrelimsTemplates,
  getPrelimsTemplate,
  createPrelimsTemplate,
  updatePrelimsTemplate,
  createPrelimsTemplateLine,
  updatePrelimsTemplateLine,
  PrelimsTemplateApiError: class PrelimsTemplateApiError extends Error {
    constructor(message, { status = 0 } = {}) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('../../admin/prelimsTemplateCostCodes', () => ({
  listCostCodesForTemplateMapping,
}));

vi.mock('../../api/costCodeClassifications', () => ({
  listCostCodeClassifications,
}));
vi.mock('../../admin/commercialStructureService', () => ({ loadCommercialStructure }));

import AdminPrelimsTemplatesPage from './AdminPrelimsTemplatesPage';

function flush() {
  return act(async () => {
    await Promise.resolve();
  });
}

function clickNamed(container, label) {
  const button = Array.from(container.querySelectorAll('button')).find((el) =>
    el.textContent.includes(label)
  );
  return act(async () => {
    button.click();
  });
}

function setFieldValue(element, value) {
  const proto =
    element.tagName === 'SELECT'
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(element, value);
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

const HOUSEBUILDING = {
  id: 'tpl-1',
  name: 'Housebuilding Prelims',
  origin: 'buildlite_standard',
  sourceStandardVersion: 1,
  isDefault: true,
  version: 1,
  lineCount: 2,
  lines: [
    {
      id: 'line-1',
      version: 1,
      templateKey: 'bl.prelims.v1.site_manager',
      name: 'Site Manager',
      description:
        'Employed or appointed site manager for the duration of the job. Core development Prelims. Not head-office overhead.',
      forecastDriver: 'TIME',
      startBasis: 'SITE_START',
      endBasis: 'FINAL_COMPLETION',
      costCodeKey: null,
      enabled: true,
      displayOrder: 10,
    },
    {
      id: 'line-2',
      version: 1,
      templateKey: 'bl.prelims.v1.cleaning_ongoing',
      name: 'Ongoing Site Cleaning',
      description: 'Recurring site cleaning through the job.',
      forecastDriver: 'TIME',
      startBasis: 'SITE_START',
      endBasis: 'FINAL_COMPLETION',
      costCodeKey: '5231',
      enabled: true,
      displayOrder: 130,
    },
  ],
};

describe('Admin Prelims Templates', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listPrelimsTemplates.mockResolvedValue({
      templates: [
        {
          id: 'tpl-1',
          name: 'Housebuilding Prelims',
          origin: 'buildlite_standard',
          sourceStandardVersion: 1,
          isDefault: true,
          lineCount: 2,
        },
      ],
    });
    getPrelimsTemplate.mockResolvedValue(HOUSEBUILDING);
    createPrelimsTemplate.mockReset();
    updatePrelimsTemplate.mockReset();
    createPrelimsTemplateLine.mockReset();
    updatePrelimsTemplateLine.mockReset();
    listCostCodesForTemplateMapping.mockResolvedValue([
      {
        code: '5231',
        value: '5231',
        description: 'Cleaning',
        element: 'Cleaning',
        reportingGroup: 'Plot & Housebuild Costs - 52',
        commercialHeadId: 'prelims',
      },
      {
        code: 'P100-SM',
        value: 'P100-SM',
        description: 'Site manager',
        element: 'Site manager',
        reportingGroup: 'Prelims',
        commercialHeadId: 'prelims',
      },
      {
        code: '5206',
        value: '5206',
        description: 'Brickwork',
        element: 'Brickwork',
        reportingGroup: 'Plot & Housebuild Costs',
        commercialHeadId: 'build',
      },
    ]);
    listCostCodeClassifications.mockResolvedValue({
      classifications: [
        { costCodeKey: '5231', semanticGroup: 'PRELIMS' },
        { costCodeKey: '5206', semanticGroup: 'BUILD' },
      ],
    });
    loadCommercialStructure.mockResolvedValue({heads:[{id:'prelims',name:'Preliminaries',buildliteCategory:'PRELIMINARIES',active:true},{id:'build',name:'House Build',buildliteCategory:'HOUSE_BUILD',active:true}],families:[],reportingGroups:[]});
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('explains BuildLite Standard and lists company templates', async () => {
    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();

    expect(container.textContent).toContain('Start with BuildLite');
    expect(container.textContent).toContain('recommended UK housebuilding Prelims structure');
    expect(container.textContent).toContain('Use BuildLite Standard');
    expect(container.textContent).toContain('Start Blank');
    expect(container.textContent).toContain('Housebuilding Prelims');
    expect(container.textContent).not.toContain('Review & Adopt');
    expect(container.textContent).not.toContain('Setup from Template');
    expect(container.textContent).not.toContain('Apply Template');
    expect(container.textContent).not.toContain('Preview Development Copy');

    await clickNamed(container, 'Housebuilding Prelims');
    await flush();
    expect(container.textContent).toContain('Site Manager');
    expect(container.textContent).toContain('duration of the job');
    expect(container.textContent).toContain('Unmapped');
    expect(container.textContent).toContain('PRELIMS');
    expect(container.textContent).toContain('2 lines · 2 enabled · 1 mapped · 1 unmapped · 0 disabled');
    expect(container.textContent).toContain('Map Cost Codes');
    expect(container.textContent).toContain('Time based');
    expect(container.textContent).toContain('Site start → Final completion');
  });

  it('uses a focused mapping workspace and saves through the existing optimistic line authority', async () => {
    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();
    await clickNamed(container, 'Housebuilding Prelims');
    await flush();
    await clickNamed(container, 'Map Cost Codes');
    await flush();

    const workspace = container.querySelector('[aria-label="Map Prelims Cost Codes"]');
    expect(workspace).toBeTruthy();
    expect(workspace.textContent).toContain('Site Manager');
    expect(container.textContent).not.toContain('Ongoing Site Cleaning');
    expect(container.textContent).toContain('Unmapped (1)');
    expect(workspace.querySelector('[aria-label="Edit template line"]')).toBeNull();
    expect(workspace.textContent).not.toContain('Forecast driver');
    expect(workspace.textContent).not.toContain('TIME start');
    expect(workspace.textContent).not.toContain('Disable');

    getPrelimsTemplate.mockResolvedValue({
      ...HOUSEBUILDING,
      lines: [
        { ...HOUSEBUILDING.lines[0], version: 2, costCodeKey: '5231' },
        HOUSEBUILDING.lines[1],
      ],
    });
    const search = workspace.querySelector('[aria-label="Site Manager cost code search"]');
    await act(async () => {
      search.focus();
      setFieldValue(search, '5231');
    });
    await act(async () => {
      document.body
        .querySelector('[aria-label="Site Manager cost code options"] [data-cost-code="5231"]')
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await flush();
    expect(updatePrelimsTemplateLine.mock.calls[0][2]).toMatchObject({
      version: 1,
      costCodeKey: '5231',
      forecastDriver: 'TIME',
      startBasis: 'SITE_START',
      endBasis: 'FINAL_COMPLETION',
    });
    expect(container.textContent).toContain('Site Manager mapping saved.');

    await clickNamed(container, 'Mapped (2)');
    expect(container.querySelector('[aria-label="Ongoing Site Cleaning cost code search"]').value).toBe('5231 — Cleaning');
    expect(container.textContent).toContain('Mapped');

    await clickNamed(container, 'Back to template');
    expect(container.querySelector('[aria-label="Map Prelims Cost Codes"]')).toBeNull();
    expect(container.textContent).toContain('Edit line');
  });

  it('keeps disabled template lines out of the routine mapping workspace', async () => {
    getPrelimsTemplate.mockResolvedValue({
      ...HOUSEBUILDING,
      lines: [
        ...HOUSEBUILDING.lines,
        {
          ...HOUSEBUILDING.lines[0],
          id: 'line-disabled',
          name: 'Disabled welfare',
          enabled: false,
          costCodeKey: null,
        },
      ],
    });
    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();
    await clickNamed(container, 'Housebuilding Prelims');
    await flush();
    expect(container.textContent).toContain('3 lines · 2 enabled · 1 mapped · 1 unmapped · 1 disabled');
    await clickNamed(container, 'Map Cost Codes');
    await flush();
    await clickNamed(container, 'All lines');
    expect(container.querySelector('[aria-label="Map Prelims Cost Codes"]').textContent).not.toContain(
      'Disabled welfare'
    );
  });

  it('creates from BuildLite Standard using the typed name', async () => {
    listPrelimsTemplates.mockResolvedValue({ templates: [] });
    getPrelimsTemplate.mockResolvedValue(null);
    createPrelimsTemplate.mockResolvedValue({
      id: 'tpl-new',
      name: 'BuildLite Standard Prelims',
      origin: 'buildlite_standard',
      sourceStandardVersion: 1,
      isDefault: true,
      lines: [],
    });
    getPrelimsTemplate.mockResolvedValue({
      id: 'tpl-new',
      name: 'BuildLite Standard Prelims',
      origin: 'buildlite_standard',
      sourceStandardVersion: 1,
      isDefault: true,
      version: 1,
      lines: [],
    });

    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();

    await clickNamed(container, 'Use BuildLite Standard');
    await flush();

    expect(createPrelimsTemplate).toHaveBeenCalledWith({
      origin: 'buildlite_standard',
      name: 'BuildLite Standard Prelims',
    });
  });

  it('renames a company template with the current optimistic version', async () => {
    updatePrelimsTemplate.mockResolvedValue({ ...HOUSEBUILDING, name: 'Renamed Prelims', version: 2 });
    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();
    await clickNamed(container, 'Housebuilding Prelims');
    await flush();

    const rename = container.querySelector('[aria-label="Rename Prelims template"]');
    await act(async () => {
      setFieldValue(rename, 'Renamed Prelims');
    });
    await clickNamed(container, 'Save name');
    await flush();

    expect(updatePrelimsTemplate).toHaveBeenCalledWith('tpl-1', {
      version: 1,
      name: 'Renamed Prelims',
    });
  });

  it('adds a custom line without a user-supplied key and maps canonical codes only', async () => {
    createPrelimsTemplateLine.mockResolvedValue({ id: 'line-new' });
    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();
    await clickNamed(container, 'Housebuilding Prelims');
    await flush();
    await clickNamed(container, 'Add template line');
    await flush();

    expect(container.textContent).not.toMatch(/monthly rate|lump sum amount|Monthly rate/i);
    expect(container.querySelector('[aria-label="TIME start basis"]')).toBeTruthy();
    const startOptions = Array.from(
      container.querySelector('[aria-label="TIME start basis"]').options
    ).map((option) => option.value);
    expect(startOptions).toEqual(['SITE_START', 'FIRST_COMPLETION', 'FINAL_COMPLETION']);
    expect(startOptions).not.toContain('FIXED_DATE');

    const search = container.querySelector('[aria-label="Mapped cost code cost code search"]');
    await act(async () => search.focus());
    const option5231 = document.body.querySelector('[aria-label="Mapped cost code cost code options"] [data-cost-code="5231"]');
    expect(option5231.textContent).toContain('Cleaning');

    const name = container.querySelector('[aria-label="Template line name"]');
    await act(async () => {
      setFieldValue(name, 'Custom welfare');
      document.body.querySelector('[aria-label="Mapped cost code cost code options"] [data-cost-code="P100-SM"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await clickNamed(container, 'Add line');
    await flush();

    expect(createPrelimsTemplateLine).toHaveBeenCalled();
    const payload = createPrelimsTemplateLine.mock.calls[0][1];
    expect(payload.templateKey).toBeUndefined();
    expect(payload.name).toBe('Custom welfare');
    expect(payload.costCodeKey).toBe('P100-SM');
    expect(payload.monthlyRate).toBeUndefined();
    expect(payload.lumpSumAmount).toBeUndefined();
  });

  it('disables a company line with the current optimistic version', async () => {
    updatePrelimsTemplateLine.mockResolvedValue({ ...HOUSEBUILDING.lines[0], enabled: false, version: 2 });
    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();
    await clickNamed(container, 'Housebuilding Prelims');
    await flush();
    await clickNamed(container, 'Disable');
    await flush();
    expect(updatePrelimsTemplateLine).toHaveBeenCalled();
    expect(updatePrelimsTemplateLine.mock.calls[0][2].enabled).toBe(false);
    expect(updatePrelimsTemplateLine.mock.calls[0][2].version).toBe(1);
  });

  it('shows shared-mapping context and classification warnings without blocking', async () => {
    getPrelimsTemplate.mockResolvedValue({
      ...HOUSEBUILDING,
      lines: [
        { ...HOUSEBUILDING.lines[1], id: 'line-2', costCodeKey: '5231' },
        {
          id: 'line-3',
          version: 1,
          templateKey: 'bl.prelims.v1.cleaning_final',
          name: 'Final Clean',
          description: 'Handover / close-out clean.',
          forecastDriver: 'LUMP_SUM',
          startBasis: null,
          endBasis: null,
          costCodeKey: '5231',
          enabled: true,
          displayOrder: 140,
        },
        {
          id: 'line-4',
          version: 1,
          templateKey: 'co.prelims.custom',
          name: 'Brickwork prelim',
          description: 'Should warn, not block',
          forecastDriver: 'LUMP_SUM',
          costCodeKey: '5206',
          enabled: false,
          displayOrder: 200,
        },
        {
          id: 'line-5',
          version: 1,
          templateKey: 'co.prelims.unclassified',
          name: 'Unclassified mapping',
          description: 'No classification row',
          forecastDriver: 'LUMP_SUM',
          costCodeKey: '1110',
          enabled: true,
          displayOrder: 210,
        },
      ],
    });

    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();
    await clickNamed(container, 'Housebuilding Prelims');
    await flush();

    expect(container.textContent).toContain('Also used on 1 other line');
    expect(container.textContent).toContain('PRELIMS');
    expect(container.textContent).toContain(
      'Mapped code 5206 is currently classified BUILD rather than PRELIMS.'
    );
    expect(container.textContent).toContain(
      'Mapped code 1110 is currently classified UNCLASSIFIED rather than PRELIMS.'
    );
    expect(container.textContent).toContain('Disabled');
    expect(container.textContent).toContain('Enable');
  });

  it('does not expose Review & Adopt, money defaults, or Cost Code Master writes', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'AdminPrelimsTemplatesPage.jsx'),
      'utf8'
    );
    expect(source).not.toMatch(/Review & Adopt|Setup from Template|Apply Template/);
    expect(source).not.toMatch(/monthlyRate|lumpSumAmount/);
    expect(source).not.toMatch(/putCostCodeClassification|updateServerCostCode|saveRecord/);
    expect(source).not.toMatch(/buildlite_cost_codes_master_v1/);
  });

  it('opens the edit form inline beneath the selected template line', async () => {
    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();
    await clickNamed(container, 'Housebuilding Prelims');
    await flush();

    const siteManagerIndex = container.textContent.indexOf('Site Manager');
    const ongoingCleaningIndex = container.textContent.indexOf('Ongoing Site Cleaning');
    expect(siteManagerIndex).toBeGreaterThan(-1);
    expect(ongoingCleaningIndex).toBeGreaterThan(siteManagerIndex);

    const editButtons = Array.from(container.querySelectorAll('button')).filter((btn) =>
      btn.textContent.trim() === 'Edit line'
    );
    await act(async () => {
      editButtons[0].click();
    });
    await flush();

    expect(container.textContent).toMatch(/Editing: Site Manager/);
    const editForm = container.querySelector('[aria-label="Edit template line"]');
    expect(editForm).toBeTruthy();

    const selectedSection = container.querySelector('[aria-label="Selected Prelims template"]');
    const tableRows = selectedSection.querySelectorAll('tbody tr');
    expect(tableRows.length).toBeGreaterThan(2);
    expect(tableRows[0].textContent).toContain('Site Manager');
    expect(tableRows[1].querySelector('[aria-label="Edit template line"]')).toBeTruthy();
    expect(tableRows[2].textContent).toContain('Ongoing Site Cleaning');
  });

  it('shows the add-line form above the template table', async () => {
    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();
    await clickNamed(container, 'Housebuilding Prelims');
    await flush();
    await clickNamed(container, 'Add template line');
    await flush();

    const addForm = container.querySelector('[aria-label="Add template line"]');
    expect(addForm).toBeTruthy();
    expect(container.textContent).toMatch(/Add template line/);

    const addFormPosition = container.textContent.indexOf('Add template line');
    const siteManagerPosition = container.textContent.indexOf('Site Manager');
    expect(addFormPosition).toBeLessThan(siteManagerPosition);
    expect(container.querySelector('.admin-prelims-line-form--add')).toBeTruthy();
  });
});
