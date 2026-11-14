// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  events: [],
  vos: [],
  items: [],
  certification: [],
  packageExposure: { ready: true, unresolvedExposure: 0, evidence: [], blockers: [] },
  canViewVa: true,
  canCreateVa: true,
  getVo: vi.fn(),
  createVa: vi.fn(),
}));

vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: permission => permission === 'variation_account.view' ? mocks.canViewVa : permission === 'variation_account.create' ? mocks.canCreateVa : true }));
vi.mock('../commercial/commercialEvents', () => ({ subscribeCommercialChanged: () => () => {} }));
vi.mock('../commercialEvents/commercialEventStore', () => ({
  listCommercialEventsByPackage: () => mocks.events,
}));
vi.mock('../api/variationOrders', () => ({
  listVariationOrders: async () => mocks.vos,
  listCertificateReadyVariationOrderLines: async () => ({ lines: mocks.certification }),
  getVariationOrder: (...args) => mocks.getVo(...args),
}));
vi.mock('../api/variationAccounts', () => ({
  loadPackageVariationAccount: async () => ({ items: mocks.items, packageExposure: mocks.packageExposure }),
  createVariationAccountItem: (...args) => mocks.createVa(...args),
}));
vi.mock('./PackageCommercialEvents', () => ({ default: () => <div>CE workbench</div> }));
vi.mock('./DirectVariationOrderPanel', () => ({ default: () => <div>VO workbench</div> }));
vi.mock('./PackageVariationAccount', () => ({ default: ({ focusItemId }) => <div>VA workbench {focusItemId}</div> }));
vi.mock('./VariationOrderDrawer', () => ({
  default: ({ open, variationOrder }) => open ? <div role="dialog">Exact VO {variationOrder.id}</div> : null,
}));

import PackageVariationsWorkspace from './PackageVariationsWorkspace';
import { buildPackageVariationRows } from '../payments/packageVariationAccountRows';

const order = {
  id: 'pkg-1', packageUuid: 'pkg-1', packageId: 'pkg-1', orderKey: 'dev::supplier::code',
  developmentId: 'dev-1',
  currentContractProvenance: {
    originalOrder: 1000,
    issuedVariationOrderValue: 125,
    approvedUninstructedValue: 0,
    pendingEventValue: 25,
    currentContract: 1125,
  },
};
const pkg = { id: 'pkg-1', packageUuid: 'pkg-1', costCode: '5470', originalOrderValue: 1000, currentContractValue: 1125 };

const directVo = {
  id: 'vo-direct', packageId: 'pkg-1', orderKey: order.orderKey,
  displayReference: 'S0014/VO-0001', description: 'Direct instruction', status: 'issued',
  totalNetValue: 125,
  sourceCommercialEvents: [],
  lines: [
    { id: 'line-a', lineNumber: 1, costCode: '5470', description: 'Drainage A', netValue: 100 },
    { id: 'line-b', lineNumber: 2, costCode: '5480', description: 'Drainage B', netValue: 25 },
  ],
};

describe('unified package Variation Account', () => {
  let host;
  let root;

  beforeEach(() => {
    mocks.events = [];
    mocks.vos = [];
    mocks.items = [];
    mocks.certification = [];
    mocks.packageExposure = { ready: true, unresolvedExposure: 0, evidence: [], blockers: [] };
    mocks.canViewVa = true;
    mocks.canCreateVa = true;
    mocks.getVo.mockReset();
    mocks.createVa.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function render(props = {}) {
    await act(async () => {
      root.render(<PackageVariationsWorkspace order={order} pkg={pkg} {...props} />);
    });
    await act(async () => Promise.resolve());
  }

  it('counts a multi-cost-code direct VO once and preserves expandable line allocation', async () => {
    mocks.vos = [directVo];
    mocks.certification = [
      { variationOrderId: 'vo-direct', variationOrderLineId: 'line-a', previouslyCertifiedValue: 40 },
      { variationOrderId: 'vo-direct', variationOrderLineId: 'line-b', previouslyCertifiedValue: 10 },
    ];
    await render();

    expect(host.textContent).toContain('S0014/VO-0001');
    expect(host.textContent).toContain('+£125.00');
    expect(host.textContent).toContain('+£50.00');
    expect(host.textContent).toContain('5470, 5480');
    expect(host.textContent).not.toContain('Drainage A');

    const expand = [...host.querySelectorAll('button')].find(button => button.textContent.includes('Show 2 cost-code lines'));
    await act(async () => expand.click());
    expect(host.textContent).toContain('Drainage A');
    expect(host.textContent).toContain('Drainage B');
    expect(host.textContent).toContain('VO total is counted once');
  });

  it('renders the existing authoritative contract provenance without reconstructing it', async () => {
    await render({ order: { ...order, currentContractProvenance: {
      originalOrder: 1000,
      approvedUninstructedValue: 75,
      issuedVariationOrderValue: 125,
      currentContract: 1200,
    } } });
    const summary = host.querySelector('[aria-label="Package variation account summary"]');
    expect(summary.textContent).toContain('Original subcontract£1,000.00');
    expect(summary.textContent).toContain('Approved, not instructed+£75.00');
    expect(summary.textContent).toContain('Effective issued VOs+£125.00');
    expect(summary.textContent).toContain('Current contract£1,200.00');
  });

  it('uses only explicit CE, VO and VA links and does not create artificial records for a direct VO', () => {
    const ce = { id: 'ce-1', eventNumber: 'CE-0001', description: 'Known change', status: 'submitted', value: 200, costCode: '5470' };
    const sourcedVo = {
      ...directVo, id: 'vo-ce', displayReference: 'S0014/VO-0002', totalNetValue: 200,
      sourceCommercialEvents: [{ id: 'ce-1', eventNumber: 'CE-0001' }],
      lines: [{ id: 'line-ce', lineNumber: 1, costCode: '5470', netValue: 200 }],
    };
    const rows = buildPackageVariationRows({
      events: [ce], variationOrders: [directVo, sourcedVo], variationItems: [], certification: [],
    });
    const ceRow = rows.find(row => row.key === 'ce:ce-1');
    const directRow = rows.find(row => row.key === 'vo:vo-direct');

    expect(ceRow.unresolved).toBeNull();
    expect(ceRow.status).toBe('Replaced by issued VO');
    expect(ceRow.related).toEqual(['S0014/VO-0002']);
    expect(directRow.related).toEqual([]);
    expect(rows.filter(row => row.kind === 'va')).toHaveLength(0);
  });

  it('presents supersession, reversal and signed omissions without overstating live VO rows', () => {
    const rows = buildPackageVariationRows({
      events: [], variationItems: [], certification: [],
      variationOrders: [
        { ...directVo, id: 'original', displayReference: 'S0014/VO-0001', totalNetValue: 750 },
        { ...directVo, id: 'successor', displayReference: 'S0014/VO-0002', totalNetValue: 500, supersedesId: 'original' },
        { ...directVo, id: 'omission', displayReference: 'S0014/VO-0003', totalNetValue: -500, reversesId: 'successor' },
      ],
    });
    expect(rows.find(row => row.id === 'original')).toMatchObject({ instructed: 0, status: 'Superseded' });
    expect(rows.find(row => row.id === 'successor')).toMatchObject({ instructed: 500, status: 'Reversed by S0014/VO-0003' });
    expect(rows.find(row => row.id === 'omission')).toMatchObject({ instructed: -500, status: 'issued' });
  });

  it('distinguishes VA-item certification from exact direct VO-line certification', async () => {
    mocks.vos = [directVo];
    mocks.certification = [{ variationOrderId: 'vo-direct', variationOrderLineId: 'line-a', previouslyCertifiedValue: 40 }];
    mocks.items = [{
      id: 'va-1', packageId: 'pkg-1', reference: 'VA-0001', description: 'QS assessed risk',
      costCode: '5470', contractorValue: 180, qsForecast: 150, forecastStatus: 'assessed', status: 'active',
      contractorClaim: 180,
      authority: { effectiveVoAuthority: 100, remainingForecastExposure: 50, allocations: [] },
    }];
    mocks.packageExposure = { ready: true, unresolvedExposure: 50, blockers: [], evidence: [
      { variationAccountItemId: 'va-1', costCode: '5470', linked: false, resultingExposure: 50 },
    ] };
    await render();

    const rows = [...host.querySelectorAll('tbody > tr')];
    const voRow = rows.find(row => row.textContent.includes('S0014/VO-0001'));
    const vaRow = rows.find(row => row.textContent.includes('VA-0001'));
    expect(voRow.textContent).toContain('+£40.00');
    expect(vaRow.textContent).toContain('VA item — see certificate');
    expect(vaRow.textContent).toContain('+£50.00');
    expect(vaRow.textContent).toContain('+£30.00');
  });

  it('shows server-owned linked exposure and focuses the exact VA assessment', async () => {
    mocks.events = [{ id: 'ce-1', eventNumber: 'CE-0001', description: 'Linked risk', status: 'submitted', value: 10000, costCode: '5470' }];
    mocks.items = [{ id: 'va-1', reference: 'VA-0001', description: 'Assessed risk', costCode: '5470', contractorValue: 8000, contractorClaim: 8000, qsForecast: 6000, status: 'active', forecastStatus: 'assessed', sourceCommercialEventId: 'ce-1', authority: { allocations: [] } }];
    mocks.packageExposure = { ready: true, unresolvedExposure: 10000, blockers: [], evidence: [
      { commercialEventId: 'ce-1', variationAccountItemId: 'va-1', costCode: '5470', linked: true, resultingExposure: 10000 },
    ] };
    await render();

    const summary = host.querySelector('[aria-label="Package variation account summary"]');
    expect(summary.textContent).toContain('+£10,000.00');
    const vaRow = [...host.querySelectorAll('tbody > tr')].find(row => row.textContent.includes('VA-0001'));
    expect(vaRow.textContent).toContain('+£10,000.00');
    expect(vaRow.textContent).toContain('+£2,000.00');
    await act(async () => [...vaRow.querySelectorAll('button')].find(button => button.textContent === 'Open assessment').click());
    expect(host.textContent).toContain('VA workbench va-1');
  });

  it('does not present a partial exposure total when the server projection is blocked', async () => {
    mocks.packageExposure = { ready: false, unresolvedExposure: null, evidence: [], blockers: [{ reason: 'linked_exposure_opposing_signs' }] };
    await render();
    const summary = host.querySelector('[aria-label="Package variation account summary"]');
    expect(summary.textContent).toContain('Package unresolved exposureUnavailable');
  });

  it('does not substitute a CE-only total when VA view permission is unavailable', async () => {
    mocks.canViewVa = false;
    mocks.events = [{ id: 'ce-1', eventNumber: 'CE-0001', description: 'Potential change', status: 'submitted', value: 10000, costCode: '5470' }];
    await render();
    const summary = host.querySelector('[aria-label="Package variation account summary"]');
    expect(summary.textContent).toContain('Package unresolved exposureUnavailable');
    expect(summary.textContent).not.toContain('+£10,000.00');
  });

  it('does not label draft or rejected VO proposals as formally instructed', () => {
    const rows = buildPackageVariationRows({ events: [], variationItems: [], certification: [], packageExposure: null, variationOrders: [
      { ...directVo, id: 'draft', status: 'draft', totalNetValue: 100 },
      { ...directVo, id: 'rejected', status: 'rejected', totalNetValue: 200 },
    ] });
    expect(rows.map(row => row.instructed)).toEqual([null, null]);
  });

  it('shows CE QS assessment only while submitted expected-liability evidence applies', () => {
    const rows = buildPackageVariationRows({ variationOrders: [], variationItems: [], certification: [], packageExposure: null, events: [
      { id: 'draft', eventNumber: 'CE-D', status: 'draft', value: 100, costCode: '5470' },
      { id: 'approved', eventNumber: 'CE-A', status: 'approved', value: 100, costCode: '5470' },
      { id: 'rejected', eventNumber: 'CE-R', status: 'rejected', value: 100, costCode: '5470' },
      { id: 'nil', eventNumber: 'CE-N', status: 'submitted', value: 100, costCode: '5470', expectedTreatment: 'override', expectedAmount: 0, effectiveExpectedLiability: 0 },
      { id: 'submitted', eventNumber: 'CE-S', status: 'submitted', value: 125, costCode: '5470' },
    ] });
    expect(rows.map(row => row.forecast)).toEqual([null, null, null, 0, 125]);
  });

  it('opens the exact tenant/package-scoped VO and retains existing action workbenches', async () => {
    mocks.vos = [directVo];
    mocks.getVo.mockResolvedValue(directVo);
    await render();
    const open = [...host.querySelectorAll('button')].find(button => button.textContent === 'Open VO');
    await act(async () => open.click());
    expect(mocks.getVo).toHaveBeenCalledWith('vo-direct');
    expect(host.textContent).toContain('Exact VO vo-direct');

    const create = [...host.querySelectorAll('button')].find(button => button.textContent === 'Create Variation Order');
    await act(async () => create.click());
    expect(host.textContent).toContain('VO workbench');
  });

  it('creates an independent package variation with distinct contractor and QS values and focuses it', async () => {
    const created = {
      id: 'va-independent', reference: 'VA-0001', description: 'Additional drainage claim',
      costCode: '5470', contractorValue: 8500, qsForecast: 6200, status: 'active',
      sourceCommercialEventId: null, authority: { allocations: [] },
    };
    mocks.createVa.mockImplementation(async () => {
      mocks.items = [created];
      return created;
    });
    await render();

    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Add Variation').click());
    const setValue = async (label, value) => {
      const input = host.querySelector(`[aria-label="${label}"]`);
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await setValue('Independent variation description', 'Additional drainage claim');
    await setValue('Independent variation supporting reference', 'BFD-CLAIM-02');
    await setValue('Independent variation contractor claimed value', '8500');
    await setValue('Independent variation QS assessment', '6200');
    await setValue('Independent variation reason', 'Measured scope supports the QS assessment');

    expect(host.querySelector('[aria-label="Independent variation package cost code"]').value).toBe('5470');
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mocks.createVa).toHaveBeenCalledWith({
      packageId: 'pkg-1', description: 'Additional drainage claim', contractorReference: 'BFD-CLAIM-02',
      contractorValue: 8500, qsForecast: 6200,
      reason: 'Measured scope supports the QS assessment',
      contractorReason: 'Measured scope supports the QS assessment',
      creationReason: 'Measured scope supports the QS assessment',
    });
    expect(host.textContent).toContain('VA workbench va-independent');
    expect(host.textContent).toContain('VA-0001');
    expect(host.textContent).toContain('+£8,500.00');
    expect(host.textContent).toContain('+£6,200.00');
    expect(mocks.items[0].sourceCommercialEventId).toBeNull();
  });

  it('uses recorded contractor position as the claim and keeps differing application evidence separate', async () => {
    mocks.items = [{
      id: 'va-claim', reference: 'VA-0002', description: 'Drainage quotation', costCode: '5470',
      contractorValue: 8500, contractorClaim: 8100, qsForecast: 6200, status: 'active',
      forecastStatus: 'assessed', authority: { allocations: [] },
    }];
    await render();
    const row = [...host.querySelectorAll('tbody > tr')].find(entry => entry.textContent.includes('VA-0002'));
    expect(row.textContent).toContain('+£8,500.00');
    expect(row.textContent).toContain('Payment application claim +£8,100.00 — differs from recorded position');
    expect(row.textContent).toContain('+£2,300.00');
  });

  it('preserves missing, explicit nil and signed omission contractor positions', () => {
    const rows = buildPackageVariationRows({ events: [], variationOrders: [], certification: [], variationItems: [
      { id: 'missing', reference: 'VA-M', contractorValue: null, contractorClaim: 100, qsForecast: 50, authority: { allocations: [] } },
      { id: 'nil', reference: 'VA-0', contractorValue: 0, contractorClaim: null, qsForecast: 0, authority: { allocations: [] } },
      { id: 'omission', reference: 'VA-N', contractorValue: -8500, contractorClaim: -8000, qsForecast: -6200, authority: { allocations: [] } },
    ] });
    expect(rows[0]).toMatchObject({ contractorClaim: null, applicationClaim: 100, claimAssessmentDifference: null });
    expect(rows[1]).toMatchObject({ contractorClaim: 0, applicationClaim: null, claimAssessmentDifference: 0 });
    expect(rows[2]).toMatchObject({ contractorClaim: -8500, applicationClaim: -8000, claimAssessmentDifference: -2300 });
  });

  it('permits an independent forecast risk without a contractor position', async () => {
    const created = { id: 'va-risk', reference: 'VA-0003', description: 'Independent risk', costCode: '5470', contractorValue: null, qsForecast: 4000, status: 'active', authority: { allocations: [] } };
    mocks.createVa.mockResolvedValue(created);
    await render();
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Add Variation').click());
    const setValue = async (label, value) => {
      const input = host.querySelector(`[aria-label="${label}"]`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await setValue('Independent variation description', 'Independent risk');
    await setValue('Independent variation QS assessment', '4000');
    await setValue('Independent variation reason', 'QS forecast risk without contractor submission');
    const submit = host.querySelector('form button[type="submit"]');
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    expect(mocks.createVa).toHaveBeenCalledWith(expect.objectContaining({ contractorValue: null, qsForecast: 4000 }));
  });

  it('does not expose independent variation creation without create permission', async () => {
    mocks.canCreateVa = false;
    await render();
    expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Add Variation')).toBe(false);
  });

  it('fails closed when an exact VO resolves to another package', async () => {
    mocks.vos = [directVo];
    mocks.getVo.mockResolvedValue({ ...directVo, packageId: 'other-package' });
    await render();
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Open VO').click());
    expect(host.querySelector('[role="alert"]').textContent).toContain('does not belong to this subcontract package');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
