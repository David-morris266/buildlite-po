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
const applyReviewedPrelimsMappings = vi.hoisted(() => vi.fn());
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
  applyReviewedPrelimsMappings,
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
import { PrelimsTemplateApiError } from '../../api/prelimsTemplates';

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

const PILOT_STANDARD_KEYS = [
  'site_manager', 'site_supervisor', 'site_admin', 'welfare',
  'temp_electrics_standing', 'temp_electrics_connection',
  'temp_water_standing', 'temp_water_connection', 'temp_compound',
  'hoarding', 'security_manning', 'security_install', 'cleaning_ongoing',
  'cleaning_final', 'skips', 'hs_management', 'testing_inspection',
  'scaffold_inspections', 'small_plant', 'consumables', 'signage', 'ppe',
  'comms', 'temp_works_recurring', 'demobilisation',
];

const PILOT_TEMPLATE = {
  ...HOUSEBUILDING,
  id: 'tpl-pilot',
  name: 'BuildLite Standard Prelims',
  lineCount: 25,
  lines: PILOT_STANDARD_KEYS.map((key, index) => ({
    id: `pilot-line-${index + 1}`,
    version: 1,
    templateKey: `bl.prelims.v1.${key}`,
    name: key.replaceAll('_', ' '),
    description: `${key} company Prelim`,
    forecastDriver: 'TIME',
    startBasis: 'SITE_START',
    endBasis: 'FINAL_COMPLETION',
    costCodeKey: null,
    enabled: true,
    displayOrder: (index + 1) * 10,
  })),
};

const PILOT_COST_CODES = [
  ['1200', 'Site Management Staff'],
  ['1210', 'Site Accommodation and Welfare'],
  ['1220', 'Temporary Services'],
  ['1230', 'Scaffolding and Safety'],
  ['1240', 'Plant and Small Tools'],
  ['1250', 'Site Security'],
  ['1260', 'Temporary Roads and Hardstandings'],
].map(([code, element]) => ({ code, value: code, description: element, element, active: true, commercialHeadId: 'prelims' }));

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
    applyReviewedPrelimsMappings.mockReset();
    applyReviewedPrelimsMappings.mockResolvedValue(HOUSEBUILDING);
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

  it('leads with the existing default template and its saved readiness', async () => {
    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();

    expect(container.textContent).toContain('Company Prelims Templates');
    expect(container.textContent).toContain('Needs setup');
    expect(container.textContent).toContain('Continue setup');
    expect(container.textContent).toContain('Saved');
    expect(container.textContent).not.toContain('Use BuildLite Standard');
    expect(container.textContent).not.toContain('Start Blank');
    expect(container.textContent).toContain('Create another template');
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

  it('makes first-time company template setup primary when no templates exist', async () => {
    listPrelimsTemplates.mockResolvedValue({ templates: [] });
    getPrelimsTemplate.mockClear();
    await act(async () => root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />));
    await flush();

    const setup = container.querySelector('[aria-label="Set up company Prelims template"]');
    expect(setup).toBeTruthy();
    expect(setup.textContent).toContain('Set up your company Prelims template');
    expect(setup.textContent).toContain('Use BuildLite Standard');
    expect(setup.textContent).toContain('Start Blank');
    expect(container.textContent).not.toContain('Create another template');
    expect(getPrelimsTemplate).not.toHaveBeenCalled();
  });

  it('shows Ready and a clear management action for a fully mapped default template', async () => {
    getPrelimsTemplate.mockResolvedValue({
      ...HOUSEBUILDING,
      lines: HOUSEBUILDING.lines.map((line) => ({ ...line, costCodeKey: line.costCodeKey || 'P100-SM' })),
    });
    await act(async () => root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />));
    await flush();

    const overview = container.querySelector('[aria-label="Current company Prelims template"]');
    expect(overview.textContent).toContain('2 mapped');
    expect(overview.textContent).toContain('0 unmapped');
    expect(overview.textContent).toContain('Ready');
    expect(overview.textContent).toContain('Manage template');
    expect(overview.textContent).not.toContain('Continue setup');
  });

  it('auto-surfaces the default while preserving access to multiple templates', async () => {
    listPrelimsTemplates.mockResolvedValue({ templates: [
      { id: 'tpl-other', name: 'Partnership Prelims', origin: 'blank', sourceStandardVersion: null, isDefault: false, lineCount: 0 },
      { id: 'tpl-1', name: 'Housebuilding Prelims', origin: 'buildlite_standard', sourceStandardVersion: 1, isDefault: true, lineCount: 2 },
    ] });
    getPrelimsTemplate.mockImplementation(async (id) => id === 'tpl-1' ? HOUSEBUILDING : {
      ...HOUSEBUILDING, id: 'tpl-other', name: 'Partnership Prelims', origin: 'blank', sourceStandardVersion: null, isDefault: false, lines: [],
    });
    getPrelimsTemplate.mockClear();
    await act(async () => root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />));
    await flush();

    expect(getPrelimsTemplate.mock.calls[0][0]).toBe('tpl-1');
    expect(container.querySelector('[aria-label="Current company Prelims template"]').textContent).toContain('Housebuilding Prelims');
    expect(container.textContent).toContain('Partnership Prelims');
  });

  it('makes additional creation explicit and handles same-name conflict without implying creation', async () => {
    listPrelimsTemplates.mockResolvedValue({ templates: [{
      id: 'tpl-1', name: 'BuildLite Standard Prelims', origin: 'buildlite_standard', sourceStandardVersion: 1, isDefault: true, lineCount: 2,
    }] });
    getPrelimsTemplate.mockResolvedValue({ ...HOUSEBUILDING, name: 'BuildLite Standard Prelims' });
    createPrelimsTemplate.mockRejectedValue(new PrelimsTemplateApiError('A Prelims template with this name already exists.', { status: 409 }));
    await act(async () => root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />));
    await flush();
    await clickNamed(container, 'Create another template');

    expect(container.textContent).toContain('This creates a new company-owned template');
    expect(container.textContent).toContain('Create new template from BuildLite Standard');
    expect(container.textContent).toContain('Start new blank template');
    await clickNamed(container, 'Create new template from BuildLite Standard');
    await flush();

    expect(createPrelimsTemplate).toHaveBeenCalledWith({ origin: 'buildlite_standard', name: 'BuildLite Standard Prelims' });
    expect(container.textContent).toContain('No template was created');
    expect(container.textContent).toContain('Manage the existing template instead');
  });

  it('preserves differently named Standard-derived template creation', async () => {
    const created = { ...HOUSEBUILDING, id: 'tpl-second', name: 'Small Sites Standard', isDefault: false };
    createPrelimsTemplate.mockResolvedValue(created);
    getPrelimsTemplate.mockResolvedValue(created);
    await act(async () => root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />));
    await flush();
    await clickNamed(container, 'Create another template');
    const name = container.querySelector('[aria-label="Prelims template name"]');
    await act(async () => setFieldValue(name, 'Small Sites Standard'));
    await clickNamed(container, 'Create new template from BuildLite Standard');
    await flush();

    expect(createPrelimsTemplate).toHaveBeenCalledWith({ origin: 'buildlite_standard', name: 'Small Sites Standard' });
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

  it('opens a reviewed proposal workspace without writing and retains existing mappings', async () => {
    await act(async () => {
      root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />);
    });
    await flush();
    await clickNamed(container, 'Housebuilding Prelims');
    await flush();
    await clickNamed(container, 'Propose mappings');
    await flush();

    const review = container.querySelector('[aria-label="Review proposed Prelims mappings"]');
    expect(review).toBeTruthy();
    expect(review.textContent).toContain('Nothing is saved until you apply');
    expect(review.textContent).toContain('Proposed');
    expect(review.textContent).toContain('Existing mapping');
    expect(updatePrelimsTemplateLine).not.toHaveBeenCalled();
    expect(applyReviewedPrelimsMappings).not.toHaveBeenCalled();

    const applyButton = Array.from(review.querySelectorAll('button')).find((button) => button.textContent.includes('Apply reviewed mappings'));
    expect(applyButton.disabled).toBe(true);
    expect(review.textContent).toContain('Review 1 proposed mapping');
    expect(review.textContent).not.toContain('Accept 1 proposed mapping');
    await clickNamed(review, 'Review 1 proposed mapping');
    expect(review.querySelector('[data-proposal-line="line-1"]')).toBeTruthy();
    expect(review.textContent).toContain('High confidence');
    expect(review.textContent).toContain('Accept 1 proposed mapping');
    expect(applyReviewedPrelimsMappings).not.toHaveBeenCalled();
    await clickNamed(review, 'Accept 1 proposed mapping');
    expect(applyReviewedPrelimsMappings).not.toHaveBeenCalled();
    expect(applyButton.disabled).toBe(false);

    await clickNamed(review, 'Apply reviewed mappings');
    await flush();
    expect(applyReviewedPrelimsMappings).toHaveBeenCalledWith('tpl-1', expect.objectContaining({
      version: 1,
      changes: [expect.objectContaining({ lineId: 'line-1', costCodeKey: 'P100-SM' })],
    }));
  });

  it('focuses normal review on unresolved exceptions and keeps bulk acceptance browser-local', async () => {
    getPrelimsTemplate.mockResolvedValue({
      ...HOUSEBUILDING,
      lines: [
        HOUSEBUILDING.lines[0],
        {
          ...HOUSEBUILDING.lines[0], id: 'line-skips', templateKey: 'bl.prelims.v1.skips',
          name: 'Skips / Waste', description: 'Regular skip exchange and site waste.', displayOrder: 150,
        },
      ],
    });
    await act(async () => root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />));
    await flush();
    await clickNamed(container, 'Housebuilding Prelims');
    await flush();
    await clickNamed(container, 'Propose mappings');

    const review = container.querySelector('[aria-label="Review proposed Prelims mappings"]');
    expect(review.textContent).toContain('1 suggested');
    expect(review.textContent).toContain('0 accepted');
    expect(review.textContent).toContain('1 need your review');
    expect(review.querySelector('[aria-label="Prelims mappings needing owner review"]').textContent).toContain('Skips / Waste');
    expect(review.querySelector('[aria-label="Proposed Prelims mappings"]').textContent).not.toContain('Site Manager —');
    expect(applyReviewedPrelimsMappings).not.toHaveBeenCalled();

    expect(review.textContent).toContain('Review 1 proposed mapping');
    expect(review.textContent).not.toContain('Accept 1 proposed mapping');
    await clickNamed(review, 'Review 1 proposed mapping');
    expect(review.querySelector('[data-proposal-line="line-1"]')).toBeTruthy();
    expect(review.textContent).toContain('High confidence');
    expect(applyReviewedPrelimsMappings).not.toHaveBeenCalled();
    await clickNamed(review, 'Accept 1 proposed mapping');
    expect(applyReviewedPrelimsMappings).not.toHaveBeenCalled();
    expect(review.textContent).toContain('0 suggested');
    expect(review.textContent).toContain('1 accepted');
    expect(review.textContent).toContain('1 need your review');
    const exception = review.querySelector('[aria-label="Prelims mappings needing owner review"]');
    const disable = exception.querySelector('input[type="checkbox"]');
    await act(async () => disable.click());
    expect(applyReviewedPrelimsMappings).not.toHaveBeenCalled();

    await clickNamed(review, 'Apply reviewed mappings');
    await flush();
    expect(applyReviewedPrelimsMappings).toHaveBeenCalledWith('tpl-1', expect.objectContaining({
      version: 1,
      changes: expect.arrayContaining([
        expect.objectContaining({ lineId: 'line-1', costCodeKey: 'P100-SM', enabled: true }),
        expect.objectContaining({ lineId: 'line-skips', costCodeKey: null, enabled: false }),
      ]),
    }));
  });

  it('shows the complete Pilot 18/7 transition and persists only through explicit Apply', async () => {
    const persisted = {
      ...PILOT_TEMPLATE,
      version: 2,
      lines: PILOT_TEMPLATE.lines.map((line, index) => index < 18
        ? { ...line, version: 2, costCodeKey: '1200' }
        : { ...line, version: 2, enabled: false }),
    };
    listPrelimsTemplates.mockResolvedValue({ templates: [{
      id: 'tpl-pilot', name: 'BuildLite Standard Prelims', origin: 'buildlite_standard', sourceStandardVersion: 1, isDefault: true, lineCount: 25,
    }] });
    getPrelimsTemplate.mockResolvedValueOnce(PILOT_TEMPLATE).mockResolvedValue(persisted);
    listCostCodesForTemplateMapping.mockResolvedValue(PILOT_COST_CODES);
    applyReviewedPrelimsMappings.mockResolvedValue(persisted);

    await act(async () => root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />));
    await flush();
    await clickNamed(container, 'Continue setup');
    const review = container.querySelector('[aria-label="Review proposed Prelims mappings"]');

    expect(review.textContent).toContain('18 suggested');
    expect(review.textContent).toContain('0 accepted');
    expect(review.textContent).toContain('7 need your review');
    expect(review.textContent).toContain('0 saved mappings');
    expect(applyReviewedPrelimsMappings).not.toHaveBeenCalled();

    expect(review.textContent).toContain('Review 18 proposed mappings');
    expect(review.textContent).not.toContain('Accept 18 proposed mappings');
    await clickNamed(review, 'Review 18 proposed mappings');
    expect(review.querySelectorAll('[data-proposal-line]').length).toBe(18);
    const siteManagementGroup = Array.from(review.querySelectorAll('.admin-prelims-proposal-group'))
      .find((group) => group.textContent.includes('1200') && group.textContent.includes('Site Management Staff'));
    expect(siteManagementGroup).toBeTruthy();
    expect(siteManagementGroup.querySelectorAll('[data-proposal-line]').length).toBe(3);
    expect(siteManagementGroup.textContent).toContain('High confidence');
    expect(siteManagementGroup.textContent).toContain('Matched site management concept');
    expect(review.textContent).toContain('Accept 18 proposed mappings');
    expect(applyReviewedPrelimsMappings).not.toHaveBeenCalled();
    await clickNamed(review, 'Accept 18 proposed mappings');
    expect(review.textContent).toContain('0 suggested');
    expect(review.textContent).toContain('18 accepted');
    expect(review.textContent).toContain('7 need your review');
    expect(review.textContent).toContain('0 saved mappings');
    expect(applyReviewedPrelimsMappings).not.toHaveBeenCalled();

    for (let index = 0; index < 7; index += 1) {
      const exceptions = review.querySelector('[aria-label="Prelims mappings needing owner review"]');
      await act(async () => exceptions.querySelector('input[type="checkbox"]').click());
    }
    expect(review.textContent).toContain('25 resolved');
    expect(review.textContent).toContain('0 need your review');
    expect(review.textContent).toContain('7 disabled');
    expect(review.textContent).toContain('Ready to apply');
    const apply = Array.from(review.querySelectorAll('button')).find((button) => button.textContent.includes('Apply reviewed mappings'));
    expect(apply.disabled).toBe(false);
    expect(applyReviewedPrelimsMappings).not.toHaveBeenCalled();

    await act(async () => apply.click());
    await flush();
    expect(applyReviewedPrelimsMappings).toHaveBeenCalledTimes(1);
    const overview = container.querySelector('[aria-label="Current company Prelims template"]');
    expect(overview.textContent).toContain('18 mapped');
    expect(overview.textContent).toContain('0 unmapped');
    expect(overview.textContent).toContain('7 disabled');
    expect(overview.textContent).toContain('Ready');
    expect(overview.textContent).toContain('Saved');
  });

  it('uses Full review for individual proposal correction and Cancel discards the browser-local review', async () => {
    getPrelimsTemplate.mockResolvedValue({
      ...HOUSEBUILDING,
      lines: [
        HOUSEBUILDING.lines[0],
        {
          ...HOUSEBUILDING.lines[0], id: 'line-admin', templateKey: 'bl.prelims.v1.site_admin',
          name: 'Site Administration', description: 'Site administration support.', displayOrder: 20,
        },
        {
          ...HOUSEBUILDING.lines[0], id: 'line-skips', templateKey: 'bl.prelims.v1.skips',
          name: 'Skips / Waste', description: 'Regular skip exchange and site waste.', displayOrder: 150,
        },
      ],
    });
    await act(async () => root.render(<AdminPrelimsTemplatesPage onBack={() => {}} />));
    await flush();
    await clickNamed(container, 'Housebuilding Prelims');
    await flush();
    await clickNamed(container, 'Propose mappings');

    let review = container.querySelector('[aria-label="Review proposed Prelims mappings"]');
    await clickNamed(review, 'Review 2 proposed mappings');
    await clickNamed(review, 'Accept 2 proposed mappings');
    await clickNamed(review.querySelector('[data-proposal-line="line-1"]'), 'Change');
    expect(review.querySelector('#prelims-full-review-line-1')).toBeTruthy();
    const search = review.querySelector('[aria-label="Site Manager full-review mapping cost code search"]');
    await act(async () => {
      search.focus();
      setFieldValue(search, '5231');
    });
    await act(async () => {
      document.body
        .querySelector('[aria-label="Site Manager full-review mapping cost code options"] [data-cost-code="5231"]')
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(search.value).toContain('5231');
    const exception = review.querySelector('[aria-label="Prelims mappings needing owner review"]');
    await act(async () => exception.querySelector('input[type="checkbox"]').click());
    expect(review.textContent).toContain('1 accepted');
    expect(review.textContent).toContain('1 disabled');
    expect(applyReviewedPrelimsMappings).not.toHaveBeenCalled();

    await clickNamed(review, 'Cancel review');
    expect(container.querySelector('[aria-label="Review proposed Prelims mappings"]')).toBeNull();
    expect(applyReviewedPrelimsMappings).not.toHaveBeenCalled();
    expect(updatePrelimsTemplateLine).not.toHaveBeenCalled();

    await clickNamed(container, 'Propose mappings');
    review = container.querySelector('[aria-label="Review proposed Prelims mappings"]');
    expect(review.textContent).toContain('2 suggested');
    expect(review.textContent).toContain('0 accepted');
    expect(review.textContent).toContain('1 need your review');
    expect(review.textContent).toContain('Review 2 proposed mappings');
    expect(review.textContent).not.toContain('Accept 2 proposed mappings');
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
      'Mapped code 5206 is currently classified HOUSE_BUILD rather than PRELIMS.'
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
