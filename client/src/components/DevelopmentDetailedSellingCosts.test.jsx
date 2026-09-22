/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DevelopmentDetailedSellingCosts from './DevelopmentDetailedSellingCosts';
import { buildDetailedSellingCostsSaveLines, normaliseDetailedSellingCostsLines } from '../sellingCosts/detailedSellingCostsAuthority';

const click = async element => act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const input = async (element, value) => act(async () => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
});
const select = async (element, value) => act(async () => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(element, value);
  element.dispatchEvent(new Event('change', { bubbles: true }));
});

function detailedProposal(overrides = {}) {
  return {
    mode: 'detailed',
    forecastRevenue: 8341500,
    forecastSellingCosts: 135122.5,
    readyLineCount: 2,
    unreadyLineCount: 0,
    lines: [
      { id: 'commission', name: 'Sales Commission / Estate Agents', forecastDriver: 'PERCENT_REVENUE', percent: 1.5, forecast: 125122.5, ready: true, issues: [], destination: { id: 'cc1', code: '6120', label: '6120 — Estate Agents', active: true } },
      { id: 'legal', name: 'Sales Legal / Conveyancing', forecastDriver: 'QUANTITY_RATE', quantitySource: 'PRIVATE_SALE_PLOTS', unitCode: 'PLOTS', resolvedQuantity: 20, rate: 500, forecast: 10000, ready: true, issues: [], quantityEvidence: { ready: true, quantity: 20 }, destination: { id: 'cc2', code: '6110', label: '6110 — Sales Legal Fees', active: true } },
    ],
    costCodeAggregation: [],
    ...overrides,
  };
}

describe('Development Detailed Selling Costs review workspace', () => {
  let root;
  let host;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); });

  async function render(proposal = detailedProposal(), props = {}) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<DevelopmentDetailedSellingCosts proposal={proposal} costCodes={[{ id: 'cc1', code: '6120', description: 'Estate Agents' }, { id: 'cc2', code: '6110', description: 'Sales Legal Fees' }]} saving={false} onSave={vi.fn()} {...props} />));
  }

  it('renders authoritative ready lines compactly with commercial summary and no open form controls', async () => {
    await render();
    expect(host.textContent).toContain('£8,341,500.00');
    expect(host.textContent).toContain('£125,122.50');
    expect(host.textContent).toContain('1.50% of Forecast Revenue');
    expect(host.textContent).toContain('20 Private-sale plots × £500.00 / plots');
    expect(host.textContent).toContain('20 Private-sale plots · From Plot Master');
    expect(host.textContent).toContain('Company assumption');
    expect(host.textContent).toContain('6120 — Estate Agents');
    expect(host.querySelectorAll('input[type="number"]')).toHaveLength(0);
    expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Review against CVR').disabled).toBe(true);
  });

  it('opens one deliberate editor, exposes dirty state, cancels without saving, and confirms explicit save', async () => {
    const onSave = vi.fn(async () => {});
    await render(detailedProposal(), { onSave });
    const changes = [...host.querySelectorAll('button')].filter(button => button.textContent === 'Change');
    await click(changes[0]);
    expect(host.querySelectorAll('[aria-label$="override"]')).toHaveLength(1);
    const percent = host.querySelector('input[type="number"]');
    await input(percent, '1.75');
    expect(host.textContent).toContain('Unsaved changes');
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Cancel'));
    expect(onSave).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Unsaved changes');
    await click([...host.querySelectorAll('button')].filter(button => button.textContent === 'Change')[0]);
    await input(host.querySelector('input[type="number"]'), '1.75');
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Save Detailed Selling Costs'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Unsaved changes');
    const refreshed = detailedProposal();
    refreshed.lines[0] = { ...refreshed.lines[0], percent: 1.75, forecast: 145976.25, assumptionOverridden: true };
    await act(async () => root.render(<DevelopmentDetailedSellingCosts proposal={refreshed} costCodes={[{ id: 'cc1', code: '6120', description: 'Estate Agents' }, { id: 'cc2', code: '6110', description: 'Sales Legal Fees' }]} saving={false} onSave={onSave} />));
    expect(host.textContent).toContain('✓ Detailed Selling Costs saved');
  });

  it('shows a specific tenure blocker and canonical resolution action without inventing quantity', async () => {
    const onReviewPlotTenures = vi.fn();
    await render(detailedProposal({ forecastSellingCosts: 0, readyLineCount: 0, unreadyLineCount: 1, lines: [{ id: 'line', name: 'Sales Legal', forecastDriver: 'QUANTITY_RATE', quantitySource: 'PRIVATE_SALE_PLOTS', unitCode: 'PLOTS', rate: 500, forecast: 0, ready: false, issues: ['quantity_source'], quantityEvidence: { ready: false, reason: 'plot-tenure-unreviewed', message: 'Review Plot Master tenure classifications.' }, destination: null }] }), { onReviewPlotTenures });
    expect(host.textContent).toContain('Plot Master tenure review required');
    const review = [...host.querySelectorAll('button')].find(button => button.textContent === 'Review Plot Master tenures');
    await click(review);
    expect(onReviewPlotTenures).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain('0 Private-sale plots');
  });

  it('makes driver override deliberate and Cancel restores the pre-edit line without persistence', async () => {
    const onSave = vi.fn();
    const proposal = detailedProposal({ forecastSellingCosts: 25000, readyLineCount: 1, lines: [{ id: 'furnishing', name: 'Show Home Furnishing', forecastDriver: 'LUMP_SUM', lumpSum: 25000, forecast: 25000, ready: true, issues: [], companyAssumption: { driver: 'LUMP_SUM', lumpSum: 25000, quantitySource: 'MANUAL', unitCode: 'EACH' }, destination: { id: 'cc1', code: '6120', label: '6120 — Estate Agents', active: true } }] });
    await render(proposal, { onSave });
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Change'));
    const driver = [...host.querySelectorAll('select')].find(control => control.closest('label')?.textContent.includes('Driver'));
    await select(driver, 'QUANTITY_RATE');
    expect(host.textContent).toContain('Quantity source');
    expect(host.textContent).toContain('Unsaved changes');
    expect(onSave).not.toHaveBeenCalled();
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Cancel'));
    expect(host.textContent).toContain('Lump sum');
    expect(host.textContent).not.toContain('Unsaved changes');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('reverts assumption independently while retaining a Development destination override', async () => {
    const onSave = vi.fn(async () => {});
    const proposal = detailedProposal({ forecastSellingCosts: 10000, readyLineCount: 1, lines: [{ id: 'furnishing', name: 'Show Home Furnishing', forecastDriver: 'QUANTITY_RATE', quantitySource: 'PRIVATE_SALE_PLOTS', resolvedQuantity: 20, rate: 500, unitCode: 'PLOTS', forecast: 10000, ready: true, issues: [], assumptionOverridden: true, destinationOverridden: true, companyAssumption: { driver: 'LUMP_SUM', lumpSum: 25000, quantitySource: 'MANUAL', unitCode: 'EACH' }, destination: { id: 'cc2', code: '6110', label: '6110 — Sales Legal Fees', active: true }, quantityEvidence: { ready: true, quantity: 20 } }] });
    proposal.lines[0].companyDestination = { id: 'cc1', code: '6120', description: 'Estate Agents', label: '6120 — Estate Agents' };
    await render(proposal, { onSave });
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Change'));
    expect(host.textContent).toContain('Company: Lump Sum');
    expect(host.textContent).toContain('Company: 6120 — Estate Agents');
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Use company calculation'));
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Save Detailed Selling Costs'));
    const savedLine = onSave.mock.calls[0][0][0];
    expect(savedLine.forecastDriver).toBe('LUMP_SUM');
    expect(savedLine.assumptionOverridden).toBe(false);
    expect(savedLine.destinationOverridden).toBe(true);
    expect(savedLine.destinationCostCodeId).toBe('cc2');
  });

  it('reverts mapping independently while retaining Development assumptions', async () => {
    const onSave = vi.fn(async () => {});
    const proposal = detailedProposal({ forecastSellingCosts: 10000, readyLineCount: 1, lines: [{ id: 'furnishing', name: 'Show Home Furnishing', forecastDriver: 'QUANTITY_RATE', quantitySource: 'PRIVATE_SALE_PLOTS', resolvedQuantity: 20, rate: 500, unitCode: 'PLOTS', forecast: 10000, ready: true, issues: [], assumptionOverridden: true, destinationOverridden: true, destinationCostCodeId: 'cc2', companyAssumption: { driver: 'LUMP_SUM', lumpSum: null, quantitySource: 'MANUAL', unitCode: 'EACH' }, destination: { id: 'cc2', code: '6110', label: '6110 — Sales Legal Fees', active: true }, quantityEvidence: { ready: true, quantity: 20 } }] });
    await render(proposal, { onSave });
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Change'));
    expect(host.textContent).toContain('Company: Unmapped');
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Use company Cost Code'));
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Save Detailed Selling Costs'));
    const savedLine = onSave.mock.calls[0][0][0];
    expect(savedLine.forecastDriver).toBe('QUANTITY_RATE');
    expect(savedLine.rate).toBe(500);
    expect(savedLine.assumptionOverridden).toBe(true);
    expect(savedLine.destinationOverridden).toBe(false);
    expect(savedLine.destinationCostCodeId).toBeNull();
  });

  it('normalises production-shaped mappings and serialises all four authority combinations', () => {
    const base={id:'line',forecastDriver:'LUMP_SUM',destination:{id:'development-code',code:'6170'},destinationCostCodeId:undefined};
    const states=[
      [false,false,null],
      [true,false,null],
      [false,true,'development-code'],
      [true,true,'development-code'],
    ];
    for (const [assumptionOverridden,destinationOverridden,expectedId] of states) {
      const hydrated=normaliseDetailedSellingCostsLines([{...base,assumptionOverridden,destinationOverridden}])[0];
      const saved=buildDetailedSellingCostsSaveLines([hydrated])[0];
      expect(saved.assumptionOverridden).toBe(assumptionOverridden);
      expect(saved.destinationOverridden).toBe(destinationOverridden);
      expect(saved.destinationCostCodeId).toBe(expectedId);
    }
    const cleared=buildDetailedSellingCostsSaveLines([{...base,destination:null,destinationCostCodeId:null,assumptionOverridden:true,destinationOverridden:true}])[0];
    expect(cleared.destinationCostCodeId).toBeNull();
  });

  it('uses line-aware readiness wording and the general Set up line action', async () => {
    await render(detailedProposal({ forecastSellingCosts: 0, readyLineCount: 0, unreadyLineCount: 1, lines: [{ id: 'furnishing', name: 'Show Home Furnishing', forecastDriver: 'LUMP_SUM', lumpSum: null, forecast: null, ready: false, issues: ['assumption', 'mapping'], companyAssumption: { driver: 'LUMP_SUM', lumpSum: null } }] }));
    expect(host.textContent).toContain('Missing: Lump sum · Cost Code');
    expect(host.textContent).not.toContain('assumption mapping');
    expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Set up line')).toBe(true);
  });

  it('separates pending configuration from stale authoritative evidence until Save refreshes it', async () => {
    const onSave = vi.fn(async () => {});
    const companyAssumption = { driver: 'LUMP_SUM', lumpSum: null, quantitySource: 'MANUAL', unitCode: 'EACH' };
    const advertising = { id: 'advertising', name: 'Advertising', forecastDriver: 'LUMP_SUM', lumpSum: 10000, forecast: 10000, ready: true, issues: [], destination: { id: 'cc1', code: '6120', label: '6120 — Estate Agents', active: true } };
    const baseline = detailedProposal({ forecastSellingCosts: 10000, readyLineCount: 1, unreadyLineCount: 1, lines: [
      { id: 'furnishing', name: 'Show Home Furnishing', forecastDriver: 'LUMP_SUM', lumpSum: null, forecast: 0, ready: false, issues: ['assumption', 'mapping'], companyAssumption, destination: null }, advertising,
    ] });
    await render(baseline, { onSave });
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Set up line'));
    await select([...host.querySelectorAll('select')].find(control => control.closest('label')?.textContent.includes('Driver')), 'QUANTITY_RATE');
    await select([...host.querySelectorAll('select')].find(control => control.closest('label')?.textContent.includes('Quantity source')), 'PRIVATE_SALE_PLOTS');
    await input([...host.querySelectorAll('input[type="number"]')].find(control => control.closest('label')?.textContent.includes('Rate')), '500');
    const mappingSearch = host.querySelector('[role="combobox"]');
    await act(async () => mappingSearch.focus());
    const showAll = [...document.body.querySelectorAll('button')].find(button => button.textContent === 'Show all Cost Codes');
    await act(async () => showAll.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await act(async () => document.body.querySelector('[role="option"][data-cost-code="6110"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(host.textContent).toContain('UNSAVED — SAVE TO RECALCULATE');
    expect(host.textContent).toContain('Forecast: Recalculates on Save');
    expect(host.textContent).toContain('Last saved: £0.00');
    expect(host.textContent).toContain('Private-sale quantity will resolve from Plot Master on Save');
    expect(host.textContent).toContain('6110 — Sales Legal Fees');
    expect(host.textContent).not.toContain('Missing: Quantity × Rate assumption');
    expect(host.textContent).not.toContain('Plot quantity is not ready');
    const furnishingRow = [...host.querySelectorAll('article')].find(row => row.textContent.includes('Show Home Furnishing'));
    expect(furnishingRow.textContent).not.toContain('£10,000.00');
    expect(host.textContent).toContain('Advertising');
    expect(host.textContent).toContain('READY');
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Save Detailed Selling Costs'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const authoritative = detailedProposal({ forecastSellingCosts: 20000, readyLineCount: 2, unreadyLineCount: 0, lines: [
      { id: 'furnishing', name: 'Show Home Furnishing', forecastDriver: 'QUANTITY_RATE', quantitySource: 'PRIVATE_SALE_PLOTS', resolvedQuantity: 20, rate: 500, unitCode: 'PLOTS', forecast: 10000, ready: true, issues: [], assumptionOverridden: true, destinationOverridden: true, destinationCostCodeId: 'cc2', companyAssumption, destination: { id: 'cc2', code: '6110', label: '6110 — Sales Legal Fees', active: true }, quantityEvidence: { ready: true, quantity: 20 } }, advertising,
    ] });
    await act(async () => root.render(<DevelopmentDetailedSellingCosts proposal={authoritative} costCodes={[{ id: 'cc1', code: '6120', description: 'Estate Agents' }, { id: 'cc2', code: '6110', description: 'Sales Legal Fees' }]} saving={false} onSave={onSave} />));
    expect(host.textContent).toContain('£10,000.00');
    expect(host.textContent).toContain('20 Private-sale plots');
    expect(host.textContent).toContain('6110 — Sales Legal Fees');
    expect(host.textContent).toContain('✓ Detailed Selling Costs saved');
    expect(host.textContent).not.toContain('UNSAVED — SAVE TO RECALCULATE');
  });

  it('retains truthful pending inputs when the authoritative save rejects', async () => {
    const onSave = vi.fn(async () => { throw new Error('Save failed'); });
    await render(detailedProposal(), { onSave });
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Change'));
    await input(host.querySelector('input[type="number"]'), '1.75');
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Save Detailed Selling Costs'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('UNSAVED — SAVE TO RECALCULATE');
    expect(host.textContent).toContain('Forecast: Recalculates on Save');
    expect(host.querySelector('input[type="number"]').value).toBe('1.75');
  });
});
