/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listServerCostCodes = vi.hoisted(() => vi.fn());
const listSellingCostsTemplates = vi.hoisted(() => vi.fn());
const getSellingCostsTemplate = vi.hoisted(() => vi.fn());
const createSellingCostsTemplate = vi.hoisted(() => vi.fn());
const updateSellingCostsTemplate = vi.hoisted(() => vi.fn());
const loadCommercialStructure = vi.hoisted(() => vi.fn());

vi.mock('../../api/costCodes', () => ({ listServerCostCodes }));
vi.mock('../../admin/commercialStructureService', () => ({ loadCommercialStructure }));
vi.mock('../../api/sellingCostsTemplates', () => ({
  listSellingCostsTemplates,
  getSellingCostsTemplate,
  createSellingCostsTemplate,
  updateSellingCostsTemplate,
}));

import AdminSellingCostsTemplatesPage from './AdminSellingCostsTemplatesPage';

const COST_CODES = [
  { id: 'cc-5400', code: '5400', description: 'Sales and marketing', commercialHeadId: 'selling', active: true },
  { id: 'cc-1100', code: '1100', description: 'Land Cost', commercialHeadId: 'land', active: true },
];

const TEMPLATE = {
  id: 'selling-template-1',
  name: 'BuildLite Standard Selling Costs',
  isDefault: true,
  version: 3,
  simpleAssumptionPercent: 2,
  simpleDestination: null,
};

function flush() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInput(element, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonNamed(container, label) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes(label));
}

async function click(element) {
  await act(async () => {
    element.click();
  });
  await flush();
}

async function choose(container, code) {
  const option = document.body.querySelector(`[role="option"][data-cost-code="${code}"]`);
  expect(option).toBeTruthy();
  await act(async () => {
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
}

describe('Admin Selling Costs Templates', () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listSellingCostsTemplates.mockResolvedValue({ templates: [TEMPLATE] });
    getSellingCostsTemplate.mockResolvedValue(TEMPLATE);
    listServerCostCodes.mockResolvedValue({ costCodes: COST_CODES });
    loadCommercialStructure.mockResolvedValue({heads:[{id:'selling',name:'Sales & Marketing',buildliteCategory:'SELLING_COSTS',active:true},{id:'land',name:'Land',buildliteCategory:'LAND',active:true}],families:[],reportingGroups:[]});
    createSellingCostsTemplate.mockReset();
    updateSellingCostsTemplate.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderAndOpen() {
    await act(async () => {
      root.render(<AdminSellingCostsTemplatesPage onBack={() => {}} />);
    });
    await flush();
    await click(buttonNamed(container, 'Open'));
    return container.querySelector('[aria-label="Selling Costs template setup"]');
  }

  it('searches by code or description, resolves a stable UUID, and saves pending percentage and mapping together', async () => {
    const editor = await renderAndOpen();
    expect(listServerCostCodes).toHaveBeenCalledWith({ activeOnly: true });
    expect(buttonNamed(container, 'Selected').disabled).toBe(true);
    expect(buttonNamed(container, 'Selected').closest('tr').getAttribute('aria-current')).toBe('true');

    const percentage = editor.querySelector('input[type="number"]');
    const search = editor.querySelector('[aria-label="Simple CVR destination cost code search"]');
    await act(async () => setInput(percentage, '1.5'));
    await act(async () => {
      search.focus();
      setInput(search, '5400');
    });
    await flush();
    expect(document.body.textContent).toContain('5400 — Sales and marketing');

    await act(async () => setInput(search, 'marketing'));
    await flush();
    expect(document.body.textContent).toContain('5400 — Sales and marketing');
    expect(updateSellingCostsTemplate).not.toHaveBeenCalled();

    await choose(editor, '5400');
    expect(editor.querySelector('[aria-label="Simple CVR destination cost code search"]').getAttribute('data-cost-code')).toBe('5400');
    expect(percentage.value).toBe('1.5');
    expect(updateSellingCostsTemplate).not.toHaveBeenCalled();

    const saved = {
      ...TEMPLATE,
      version: 4,
      simpleAssumptionPercent: 1.5,
      simpleDestination: COST_CODES[0],
    };
    updateSellingCostsTemplate.mockResolvedValue(saved);
    getSellingCostsTemplate.mockResolvedValue(saved);
    await click(buttonNamed(editor, 'Save Simple setup'));

    expect(updateSellingCostsTemplate).toHaveBeenCalledWith(TEMPLATE.id, {
      version: 3,
      simpleAssumptionPercent: 1.5,
      simpleDestinationCostCodeId: 'cc-5400',
      isDefault: true,
    });
    expect(editor.querySelector('[aria-label="Simple CVR destination cost code search"]').value).toBe('5400 — Sales and marketing');
    expect(container.textContent).toContain('Simple Selling Costs setup saved.');
  });

  it('shows no matches, never treats free text as authority, and explicitly clears an existing UUID mapping', async () => {
    const mapped = { ...TEMPLATE, simpleDestination: COST_CODES[0] };
    getSellingCostsTemplate.mockResolvedValue(mapped);
    const editor = await renderAndOpen();
    const search = editor.querySelector('[aria-label="Simple CVR destination cost code search"]');

    await act(async () => {
      search.focus();
      setInput(search, 'not a cost code');
    });
    await flush();
    expect(document.body.textContent).toContain('No matches');
    expect(updateSellingCostsTemplate).not.toHaveBeenCalled();

    await act(async () => setInput(search, ''));
    await flush();
    await choose(editor, '');
    expect(editor.querySelector('[aria-label="Simple CVR destination cost code search"]').getAttribute('data-cost-code')).toBe('');
    expect(updateSellingCostsTemplate).not.toHaveBeenCalled();

    updateSellingCostsTemplate.mockResolvedValue({ ...mapped, version: 4, simpleDestination: null });
    getSellingCostsTemplate.mockResolvedValue({ ...mapped, version: 4, simpleDestination: null });
    await click(buttonNamed(editor, 'Save Simple setup'));
    expect(updateSellingCostsTemplate).toHaveBeenCalledWith(
      TEMPLATE.id,
      expect.objectContaining({ simpleDestinationCostCodeId: null })
    );
  });

  it('reports Cost Code loading failures and an empty active Cost Code Master', async () => {
    listServerCostCodes.mockRejectedValueOnce(new Error('network unavailable'));
    let editor = await renderAndOpen();
    expect(editor.textContent).toContain('Cost Code Master could not be loaded: network unavailable');
    expect(editor.querySelector('[aria-label="Simple CVR destination cost code search"]')).toBeNull();

    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listServerCostCodes.mockResolvedValueOnce({ costCodes: [] });
    editor = await renderAndOpen();
    expect(editor.textContent).toContain('No active Cost Codes are available to map.');
  });

  it('marks only the active template as Selected and opens another template into the editor', async () => {
    const second = { ...TEMPLATE, id: 'selling-template-2', name: 'Alternative Selling Costs', isDefault: false };
    listSellingCostsTemplates.mockResolvedValue({ templates: [TEMPLATE, second] });
    getSellingCostsTemplate.mockImplementation(async (id) => (id === second.id ? second : TEMPLATE));
    vi.stubGlobal('requestAnimationFrame', (callback) => callback());
    Element.prototype.scrollIntoView = vi.fn();

    await act(async () => root.render(<AdminSellingCostsTemplatesPage onBack={() => {}} />));
    await flush();
    await click(buttonNamed(container, 'Open'));
    expect(container.textContent).toContain('Selected');

    const openButtons = Array.from(container.querySelectorAll('button')).filter((button) => button.textContent.includes('Open'));
    await click(openButtons[0]);
    expect(container.querySelector('[aria-label="Selling Costs template setup"]').textContent).toContain('Alternative Selling Costs');
    expect(document.activeElement.getAttribute('role')).toBe('tab');
    expect(document.activeElement.textContent).toBe('Simple');
  });

  it('uses alternative method views, remains closed on selection, and retains pending edits without saving', async () => {
    const withLine={...TEMPLATE,lines:[{id:'line-1',name:'Sales legal',forecastDriver:'QUANTITY_RATE',defaultQuantity:1,defaultRate:500,quantitySource:'MANUAL',unitCode:'PLOTS',enabled:true,costCode:COST_CODES[0]}]};
    getSellingCostsTemplate.mockResolvedValue(withLine);
    vi.stubGlobal('requestAnimationFrame',(callback)=>callback());
    Element.prototype.scrollIntoView=vi.fn();
    const editor=await renderAndOpen();
    expect(editor.querySelector('[role="listbox"]')).toBeNull();
    expect(editor.querySelector('[aria-label="Simple Selling Costs setup"]')).toBeTruthy();
    expect(editor.querySelector('[aria-label="Detailed Selling Costs setup"]')).toBeNull();
    const percent=editor.querySelector('input[type="number"]');
    await act(async()=>setInput(percent,'1.5'));
    await click([...editor.querySelectorAll('[role="tab"]')].find(tab=>tab.textContent==='Detailed'));
    expect(editor.querySelector('[aria-label="Simple Selling Costs setup"]')).toBeNull();
    expect(editor.querySelector('[aria-label="Detailed Selling Costs setup"]')).toBeTruthy();
    expect(editor.textContent).toContain('£');
    expect(editor.textContent).toContain('/ plots');
    await click([...editor.querySelectorAll('[role="tab"]')].find(tab=>tab.textContent==='Simple'));
    expect(editor.querySelector('input[type="number"]').value).toBe('1.5');
    expect(updateSellingCostsTemplate).not.toHaveBeenCalled();
  });
});
