/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const previewDevelopmentPrelimsSetup = vi.hoisted(() => vi.fn());
const applyDevelopmentPrelimsSetup = vi.hoisted(() => vi.fn());
const listPrelimsTemplates = vi.hoisted(() => vi.fn());
const listCostCodes = vi.hoisted(() => vi.fn());
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

vi.mock('../api', () => ({
  listCostCodes,
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
  const proto = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
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
    listCostCodes.mockResolvedValue([{ code: '5210' }, { code: '5231' }, { code: 'UAT-CC-001' }]);
    getCostCodeClassification.mockImplementation(async (key) => {
      if (key === '5231') return { semanticGroup: 'PRELIMS', exists: true };
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
    expect(container.querySelector('[aria-label="Select Ongoing Site Cleaning"]').checked).toBe(false);
    expect(container.querySelector('[aria-label="Select Disabled welfare"]').disabled).toBe(true);

    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Site Manager monthly rate"]'), '5500');
    });
    expect(container.textContent).toMatch(/£209,000/);
  });

  it('creates only selected ready lines once, including a preview-only mapped custom line', async () => {
    await renderSheet();
    await act(async () => {
      setInputValue(container.querySelector('[aria-label="Site Manager monthly rate"]'), '5500');
      setInputValue(container.querySelector('[aria-label="BL-033D.x.2 CUSTOM UAT cost code"]'), 'UAT-CC-001');
      setInputValue(container.querySelector('[aria-label="BL-033D.x.2 CUSTOM UAT lump-sum amount"]'), '250');
      container.querySelector('[aria-label="Select BL-033D.x.2 CUSTOM UAT"]').click();
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
});
