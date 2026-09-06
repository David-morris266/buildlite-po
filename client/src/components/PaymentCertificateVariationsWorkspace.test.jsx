// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permissions: new Set(['variation_account.create', 'variation_account.assess']),
  applications: vi.fn(), lines: vi.fn(), account: vi.fn(), assessments: vi.fn(),
  events: vi.fn(),
  add: vi.fn(), match: vi.fn(), create: vi.fn(), save: vi.fn(), withdraw: vi.fn(), refresh: vi.fn(),
}));
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: (permission) => mocks.permissions.has(permission) }));
vi.mock('../api/paymentApplications', () => ({
  listPaymentApplications: mocks.applications,
  listApplicationVariations: mocks.lines,
  listPackageVariationAccount: mocks.account,
  addApplicationVariation: mocks.add,
  matchApplicationVariation: mocks.match,
  createVariationFromApplication: mocks.create,
}));
vi.mock('../api/paymentCertificates', () => ({
  listVariationAssessments: mocks.assessments,
  saveVariationAssessment: mocks.save,
  withdrawVariationAssessment: mocks.withdraw,
}));
vi.mock('../api/commercialEvents', () => ({ listCommercialEvents: mocks.events }));
vi.mock('../payments/paymentCertificateServerCache', () => ({ refreshCertificatesForPackage: mocks.refresh }));
import PaymentCertificateVariationsWorkspace from './PaymentCertificateVariationsWorkspace';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const application = { id: 'app-1', status: 'recorded', revisionNumber: 1 };
const known = { id: 'va-1', reference: 'VA-0001', description: 'Drainage', status: 'active', contractorValue: 20000, qsForecast: 17000, authority: { effectiveVoAuthority: 12000, effectiveRecognisedAuthority: 12000 } };
const readiness = { variationAccountItemId: 'va-1', reference: 'VA-0001', description: 'Drainage', contractorValue: 20000, contractorClaim: 10000, qsForecast: 17000, previousCertified: 2000, applicationVariationLineId: 'line-1', inCurrentApplication: true, assessment: { id: 'assessment-1', currentAssessment: 3500, cumulativeCertified: 5500, basis: 'Measured work' } };
let host; let root;
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function render(certificate = { id: 'cert-1', version: 1, sourceAuthority: { evidence: { variationAssessments: [{ variationAccountItemId: 'va-1', unapprovedAmount: 0 }, { variationAccountItemId: 'va-new', unapprovedAmount: 1500 }] } } }) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<PaymentCertificateVariationsWorkspace packageId="pkg-1" certificate={certificate} editable />));
  await settle(); return host;
}
function button(label) { return [...host.querySelectorAll('button')].find((entry) => entry.textContent.includes(label)); }
async function input(node, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  mocks.permissions = new Set(['variation_account.create', 'variation_account.assess']);
  mocks.applications.mockResolvedValue([application]);
  mocks.lines.mockResolvedValue([{ id: 'line-1', variationAccountItemId: 'va-1', contractorReference: 'DR-1', description: 'Drainage', contractorValue: 20000, previousClaim: 0, currentClaim: 10000, cumulativeClaim: 10000 }]);
  mocks.account.mockResolvedValue([known]); mocks.assessments.mockResolvedValue({ items: [readiness] }); mocks.refresh.mockResolvedValue();
  mocks.events.mockResolvedValue([]);
});
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.clearAllMocks(); });

describe('PaymentCertificateVariationsWorkspace', () => {
  it('presents contractor evidence, prior/current/cumulative assessment and recognised authority in six columns', async () => {
    await render();
    expect([...host.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(['Variation', 'Contractor claim', 'Previous', 'QS assessment', 'To date', 'Status / authority']);
    expect(host.textContent).toContain('£10,000.00'); expect(host.textContent).toContain('£2,000.00');
    expect(host.textContent).toContain('Issued VO — £12,000.00'); expect(host.textContent).toContain('QS Forecast £17,000.00');
    expect(host.textContent).not.toContain('Direct CE'); expect(host.textContent).not.toContain('Legacy');
  });

  it('records a first application claim with truthful zero-previous arithmetic', async () => {
    await render(); await act(async () => button('Add contractor variation').click());
    const fields = [...host.querySelectorAll('.po-cert-variations-workspace__capture input')];
    for (const [index, value] of ['NEW-1', 'Additional work', '2000', '1500'].entries()) await input(fields[index], value);
    await act(async () => { [...host.querySelectorAll('button')].find((entry) => entry.textContent === 'Add variation').click(); await Promise.resolve(); });
    expect(mocks.add).toHaveBeenCalledWith('pkg-1', 'app-1', expect.objectContaining({ contractorValue: '2000', previousClaim: 0, currentClaim: 1500, cumulativeClaim: 1500 }));
  });

  it('matches an existing variation without creating another', async () => {
    mocks.lines.mockResolvedValue([{ id: 'line-new', contractorReference: 'NEW', description: 'New work', currentClaim: 1500, cumulativeClaim: 1500 }]);
    mocks.assessments.mockResolvedValue({ items: [] }); await render();
    const select = host.querySelector('[aria-label="Variations requiring reconciliation"] select');
    await act(async () => { select.value = 'va-1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.querySelector('[aria-label="Use existing variation"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="Create new variation"]')).toBeTruthy();
    await act(async () => { button('Use existing').click(); await Promise.resolve(); });
    expect(mocks.match).toHaveBeenCalledWith('pkg-1', 'app-1', 'line-new', 'va-1'); expect(mocks.create).not.toHaveBeenCalled();
  });

  it('requires a deliberate forecast and reason when creating a new variation', async () => {
    mocks.lines.mockResolvedValue([{ id: 'line-new', contractorReference: 'NEW', description: 'New work', currentClaim: 1500, cumulativeClaim: 1500 }]);
    mocks.assessments.mockResolvedValue({ items: [] }); await render();
    expect(button('Create new variation').disabled).toBe(true);
    const task = host.querySelector('.po-cert-variations-workspace__task'); const inputs = task.querySelectorAll('input');
    await input(inputs[0], '-2000'); await input(inputs[1], 'QS judgement');
    await act(async () => { button('Create new variation').click(); await Promise.resolve(); });
    expect(mocks.create).toHaveBeenCalledWith('pkg-1', 'app-1', 'line-new', { qsForecast: -2000, reason: 'QS judgement' });
  });

  it('makes Create New the clear route when no eligible existing variation exists', async () => {
    mocks.lines.mockResolvedValue([{ id: 'line-new', contractorReference: 'NEW', description: 'New work', currentClaim: 1500, cumulativeClaim: 1500 }]);
    mocks.account.mockResolvedValue([]); mocks.assessments.mockResolvedValue({ items: [] });
    await render();
    expect(host.querySelector('[aria-label="Use existing variation"]')).toBeNull();
    expect(host.textContent).toContain('No existing Variation Account item is available to use.');
    expect(host.querySelector('[aria-label="Create new variation"]')).toBeTruthy();
    expect(button('Create new variation').disabled).toBe(true);
  });

  it('saves a signed QS assessment and basis then reloads authoritative data', async () => {
    await render(); const amount = host.querySelector('[aria-label="VA-0001 QS assessment this certificate"]'); const basis = host.querySelector('[aria-label="VA-0001 assessment basis"]');
    await input(amount, '-500'); await input(basis, 'Credit assessment');
    await act(async () => { button('Update assessment').click(); await Promise.resolve(); });
    expect(mocks.save).toHaveBeenCalledWith('pkg-1', 'cert-1', expect.objectContaining({ currentAssessment: -500, basis: 'Credit assessment', applicationVariationLineId: 'line-1' }));
    expect(mocks.refresh).toHaveBeenCalledWith('pkg-1'); expect(mocks.assessments).toHaveBeenCalledTimes(2);
  });

  it('keeps unrelated active items behind Add existing variation and exposes no-prior-authority evidence', async () => {
    const extra = { id: 'va-new', reference: 'VA-0002', description: 'Additional work', status: 'active', contractorValue: 2000, qsForecast: 1800, authority: { effectiveRecognisedAuthority: 0 } };
    mocks.account.mockResolvedValue([known, extra]); mocks.assessments.mockResolvedValue({ items: [readiness, { variationAccountItemId: 'va-new', reference: 'VA-0002', description: 'Additional work', contractorValue: 2000, contractorClaim: null, qsForecast: 1800, previousCertified: 0, inCurrentApplication: false, assessment: null }] });
    await render(); expect([...host.querySelectorAll('tbody tr')].map((row) => row.textContent)).not.toContain(expect.stringContaining('VA-0002')); const select = [...host.querySelectorAll('select')].find((entry) => entry.parentElement.textContent.includes('Add existing variation'));
    await act(async () => { select.value = 'va-new'; select.dispatchEvent(new Event('change', { bubbles: true })); button('Add to assessment').click(); });
    expect(host.textContent).toContain('VA-0002');
    const amount = host.querySelector('[aria-label="VA-0002 QS assessment this certificate"]'); const basis = host.querySelector('[aria-label="VA-0002 assessment basis"]');
    await input(amount, '1500'); await input(basis, 'Measured work');
    expect(host.textContent).toContain('No prior authority — £1,500.00 unapproved'); expect(host.textContent).toContain('Unapproved variation assessment£1,500.00');
  });

  it('blocks a routine VA assessment when its allocated VO is already a direct certificate line', async () => {
    const allocated = { ...known, authority: { ...known.authority, allocations: [{ variationOrderLineId: 'vo-line-1' }] } };
    mocks.account.mockResolvedValue([allocated]);
    await render({ id: 'cert-1', version: 1, commercialLines: [{ sourceType: 'variationOrder', variationOrderLineId: 'vo-line-1' }] });
    expect(host.textContent).toContain('Already included as a direct authorised variation');
    expect(button('Update assessment').disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('shows a submitted contract-value CE as non-payable awareness without changing totals', async () => {
    mocks.lines.mockResolvedValue([]); mocks.account.mockResolvedValue([]); mocks.assessments.mockResolvedValue({ items: [] });
    mocks.events.mockResolvedValue([{ id: 'ce-hg-009', eventNumber: 'CE-HG009', description: 'Revised valley detail', status: 'submitted', eventType: 'variation', financialTreatment: 'contractAmendment', value: 8000, effectiveExpectedLiability: 8000 }]);
    await render(); const known = host.querySelector('[aria-label="Known commercial items"]');
    expect(known.textContent).toContain('CE-HG009 · Revised valley detail'); expect(known.textContent).toContain('Submitted CE · £8,000.00');
    expect(known.textContent).toContain('Included in CVR expected liability: £8,000.00'); expect(known.textContent).toContain('Not approved certificate authority');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(0); expect(host.querySelector('[aria-label="Variation assessment summary"]').textContent).toContain('QS assessment this certificate£0.00');
  });

  it('keeps known CE context visible while reconciling an unresolved application variation', async () => {
    mocks.lines.mockResolvedValue([{ id: 'line-new', contractorReference: 'NEW', description: 'Valley work', currentClaim: 5000, cumulativeClaim: 5000 }]);
    mocks.events.mockResolvedValue([{ id: 'ce-1', eventNumber: 'CE-1', description: 'Valley detail', status: 'submitted', eventType: 'variation', financialTreatment: 'contractAmendment', value: 8000, expectedLiability: 8000 }]);
    await render(); expect(host.querySelector('.po-cert-variations-workspace__task').textContent).toContain('Known commercial items exist on this package');
    expect(button('Create new variation')).toBeTruthy(); expect(host.textContent).not.toContain('Match CE');
  });

  it('excludes represented, rejected and recovery events from awareness', async () => {
    const represented = { ...known, authority: { ...known.authority, allocations: [{ commercialEventId: 'ce-approved' }] } };
    mocks.account.mockResolvedValue([represented]);
    mocks.events.mockResolvedValue([
      { id: 'ce-approved', eventNumber: 'CE-A', status: 'approved', eventType: 'variation', financialTreatment: 'contractAmendment', value: 1000 },
      { id: 'ce-rejected', eventNumber: 'CE-R', status: 'rejected', eventType: 'variation', financialTreatment: 'contractAmendment', value: 2000 },
      { id: 'ce-recovery', eventNumber: 'CE-C', status: 'submitted', eventType: 'contraCharge', relationshipType: 'recovery', financialTreatment: 'recoverableDeduction', value: -500 },
    ]);
    await render(); expect(host.querySelector('[aria-label="Known commercial items"]')).toBeNull();
  });
});
