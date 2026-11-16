// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permissions: new Set(['variation_account.create', 'variation_account.assess']),
  applications: vi.fn(), lines: vi.fn(), candidates: vi.fn(), account: vi.fn(), assessments: vi.fn(),
  add: vi.fn(), match: vi.fn(), reconcile: vi.fn(), save: vi.fn(), withdraw: vi.fn(), refresh: vi.fn(),
}));
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: p => mocks.permissions.has(p) }));
vi.mock('../api/paymentApplications', () => ({
  listPaymentApplications: mocks.applications, listApplicationVariations: mocks.lines,
  listPackageVariationAccount: mocks.account, addApplicationVariation: mocks.add, matchApplicationVariation: mocks.match,
}));
vi.mock('../api/paymentCertificates', () => ({
  listCertificateVariationCandidates: mocks.candidates, reconcileAndAssessCertificateVariation: mocks.reconcile,
  listVariationAssessments: mocks.assessments, saveVariationAssessment: mocks.save,
  withdrawVariationAssessment: mocks.withdraw,
}));
vi.mock('../payments/paymentCertificateServerCache', () => ({ refreshCertificatesForPackage: mocks.refresh }));
import PaymentCertificateVariationsWorkspace from './PaymentCertificateVariationsWorkspace';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host; let root;
const certificate = { id: 'cert-1', status: 'draft', sourceAuthority: { evidence: { variationAssessments: [] } } };
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function render() { host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);await act(async()=>root.render(<PaymentCertificateVariationsWorkspace packageId="pkg-1" certificate={certificate} editable/>));await settle(); }
function button(label){return [...host.querySelectorAll('button')].find(node=>node.textContent.includes(label));}
async function input(node,value){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});}

beforeEach(()=>{
  mocks.permissions=new Set(['variation_account.create','variation_account.assess']);
  mocks.applications.mockResolvedValue([{id:'app-1',status:'recorded'}]);
  mocks.lines.mockResolvedValue([{id:'line-1',contractorReference:'CE-0009 Greenleaf',description:'VO authority substitution UAT',currentClaim:2500,cumulativeClaim:2500}]);
  mocks.candidates.mockResolvedValue({candidates:[{id:'authority:ce-9',kind:'existing_approved',reference:'CE-0009',description:'VO authority substitution UAT',currentAuthority:4500,reviewRequired:false}]});
  mocks.account.mockResolvedValue([]);mocks.assessments.mockResolvedValue({items:[]});mocks.refresh.mockResolvedValue();mocks.reconcile.mockResolvedValue({});mocks.add.mockResolvedValue({id:'line-created'});
});
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();vi.clearAllMocks();});

describe('PaymentCertificateVariationsWorkspace simplified workflow',()=>{
  it('starts a fresh application from an existing approved variation and preserves its candidate through assessment',async()=>{
    mocks.lines.mockResolvedValue([]);
    await render();
    const select=host.querySelector('[aria-label="Existing approved variation"]');
    expect(select.textContent).toContain('£4,500.00');
    await act(async()=>{select.value='authority:ce-9';select.dispatchEvent(new Event('change',{bubbles:true}));});
    const values=[
      ['Existing variation contractor reference','CE-0009 Greenleaf'],
      ['Existing variation contractor value','5000'],
      ['Existing variation contractor claim','2500'],
      ['Existing variation QS assessment','2500'],
      ['Existing variation assessment basis','Measured works'],
    ];
    for(const [label,value] of values)await input(host.querySelector(`[aria-label="${label}"]`),value);
    await act(async()=>{button('Add claim and assessment').click();await Promise.resolve();});
    expect(mocks.add).toHaveBeenCalledWith('pkg-1','app-1',{contractorReference:'CE-0009 Greenleaf',description:'VO authority substitution UAT',contractorValue:'5000',previousClaim:0,currentClaim:2500,cumulativeClaim:2500});
    expect(mocks.reconcile).toHaveBeenCalledWith('pkg-1','cert-1','app-1','line-created',{candidateId:'authority:ce-9',currentAssessment:2500,basis:'Measured works'});
  });

  it('keeps review-required approved lineage visible but unavailable for automatic use',async()=>{
    mocks.lines.mockResolvedValue([]);
    mocks.candidates.mockResolvedValue({candidates:[{id:'authority:ce-9',kind:'existing_approved',reference:'CE-0009',description:'Ambiguous',currentAuthority:null,reviewRequired:true,reviewReason:'Multiple issued lines require review.'}]});
    await render();
    expect(host.textContent).toContain('Multiple issued lines require review.');
    expect(host.querySelector('option[value="authority:ce-9"]').disabled).toBe(true);
  });

  it('presents one current approved authority without exposing VA mechanics',async()=>{
    await render();
    expect(host.textContent).toContain('current approved authority');
    expect(host.textContent).toContain('CE-0009');
    expect(host.textContent).toContain('£4,500.00');
    expect(host.textContent).not.toContain('Create VA');
  });

  it('warns when cumulative certificate assessment exceeds live VO authority',async()=>{
    mocks.lines.mockResolvedValue([{id:'line-1',variationAccountItemId:'va-1',contractorReference:'VO-1',description:'Instructed work',currentClaim:500,cumulativeClaim:500}]);
    mocks.account.mockResolvedValue([{id:'va-1',status:'active',reference:'VA-0001',description:'Instructed work',forecastStatus:'pending',qsForecast:null,authority:{effectiveRecognisedAuthority:500,effectiveVoAuthority:500,allocations:[]}}]);
    mocks.assessments.mockResolvedValue({items:[{variationAccountItemId:'va-1',reference:'VA-0001',description:'Instructed work',inCurrentApplication:true,previousCertified:0,contractorClaim:500,assessment:{id:'assessment-1',currentAssessment:550,basis:'Measured works'}}]});
    await render();
    expect(host.textContent).toContain('Assessment to date £550.00 exceeds current authority £500.00');
  });

  it('submits claim assessment through the atomic reconciliation command',async()=>{
    await render();
    const select=host.querySelector('select');
    await act(async()=>{select.value='authority:ce-9';select.dispatchEvent(new Event('change',{bubbles:true}));});
    const inputs=[...host.querySelectorAll('.po-cert-variations-workspace__task input')];
    await input(inputs[0],'2500');
    await input(inputs[1],'Measured work complete');
    await act(async()=>{button('Apply assessment').click();await Promise.resolve();});
    expect(mocks.reconcile).toHaveBeenCalledWith('pkg-1','cert-1','app-1','line-1',{candidateId:'authority:ce-9',currentAssessment:2500,basis:'Measured work complete'});
    expect(mocks.refresh).toHaveBeenCalledWith('pkg-1');
  });

  it('keeps ambiguous lineage review-required and non-actionable',async()=>{
    mocks.candidates.mockResolvedValue({candidates:[{id:'authority:ce-9',kind:'existing_approved',reference:'CE-0009',description:'Ambiguous',currentAuthority:null,reviewRequired:true,reviewReason:'Multiple issued lines require review.'}]});
    await render();
    expect(host.textContent).toContain('Needs review');
    expect(button('Apply assessment')).toBeUndefined();
  });

  it('offers a plain new/unapproved route without requiring a forecast',async()=>{
    mocks.candidates.mockResolvedValue({candidates:[]});await render();
    expect(host.textContent).toContain('New / unapproved variation');
    const select=host.querySelector('select');
    await act(async()=>{select.value='new';select.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(host.textContent).toContain('QS assessment this certificate');
  });
});


describe('existing VA application claim entry', () => {
  const item = { variationAccountItemId:'va-1', reference:'VA-0001', description:'Additional hot water circulation pipework', contractorValue:8500, qsForecast:6200, previousCertified:0, inCurrentApplication:false, assessment:null };
  beforeEach(() => {
    mocks.lines.mockResolvedValue([]);
    mocks.candidates.mockResolvedValue({candidates:[]});
    mocks.account.mockResolvedValue([{...item,id:'va-1',status:'active'}]);
    mocks.assessments.mockResolvedValue({items:[item]});
    mocks.match.mockReset().mockResolvedValue({});
    mocks.add.mockImplementation(async (_pkg, _app, body) => ({id:'claim-1',...body}));
  });
  async function showRow() {
    await render();
    const select=host.querySelector('.po-cert-variations-workspace__add-existing select');
    await act(async()=>{select.value='va-1';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await act(async()=>button('Add to assessment').click());
  }
  async function openClaim() { await showRow();await act(async()=>button('Record claim this application').click()); }
  it('records \u00a38500 against the exact existing VA without assigning a QS assessment',async()=>{
    await openClaim();
    const amount=host.querySelector('[aria-label="VA-0001 current application claim"]');
    expect(amount.value).toBe('');expect(button('Save application claim').disabled).toBe(true);
    expect(host.querySelector('[aria-label="VA-0001 QS assessment this certificate"]').value).toBe('');
    await input(amount,'8500');
    await act(async()=>button('Save application claim').click());
    expect(mocks.add).toHaveBeenCalledWith('pkg-1','app-1',{contractorReference:'VA-0001',description:item.description,contractorValue:8500,previousClaim:0,currentClaim:8500,cumulativeClaim:8500});
    expect(mocks.match).toHaveBeenCalledWith('pkg-1','app-1','claim-1','va-1');
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledWith('pkg-1');
  });
  it.each(['0','-500'])('preserves explicit signed claim %s',async value=>{
    await openClaim();await input(host.querySelector('[aria-label="VA-0001 current application claim"]'),value);
    await act(async()=>button('Save application claim').click());
    expect(mocks.add.mock.calls[0][2].currentClaim).toBe(Number(value));
  });
  it('recovers a failed match without creating another claim, including after reload',async()=>{
    mocks.match.mockRejectedValueOnce(new Error('Match failed'));
    await openClaim();await input(host.querySelector('[aria-label="VA-0001 current application claim"]'),'8500');
    await act(async()=>button('Save application claim').click());
    expect(host.textContent).toContain('Claim evidence recorded but not matched');
    expect(button('Save application claim')).toBeUndefined();
    const unmatched={id:'claim-1',description:item.description,currentClaim:8500,cumulativeClaim:8500};
    mocks.lines.mockResolvedValue([unmatched]);
    await act(async()=>root.unmount());host.remove();
    await openClaim();
    const select=host.querySelector('[aria-label="VA-0001 unmatched claim evidence"]');
    await act(async()=>{select.value='claim-1';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await act(async()=>button('Match existing claim to VA-0001').click());
    expect(mocks.add).toHaveBeenCalledTimes(1);expect(mocks.match).toHaveBeenCalledTimes(2);
  });
  it('shows current and cumulative claims distinctly, authoritative history and \u00a32300 difference',async()=>{
    mocks.lines.mockResolvedValue([{id:'claim-1',variationAccountItemId:'va-1',currentClaim:8500,cumulativeClaim:9500}]);
    mocks.assessments.mockResolvedValue({items:[{...item,inCurrentApplication:true,contractorClaim:9500,previousCertified:1000,assessment:{currentAssessment:6200,cumulativeCertified:7200,basis:'Measured'}}]});
    await render();
    expect(host.textContent).toContain('Current claim \u00a38,500.00');expect(host.textContent).toContain('Cumulative application claim \u00a39,500.00');
    const row=host.querySelector('tbody tr');expect(row.textContent).toContain('\u00a31,000.00');expect(row.textContent).toContain('\u00a37,200.00');expect(row.textContent).toContain('\u00a32,300.00');
    expect(host.querySelector('[aria-label="Variation assessment summary"]').textContent).toContain('Contractor claims this period\u00a38,500.00');
  });
  it('requires Stage 1 before offering claim entry',async()=>{
    mocks.applications.mockResolvedValue([]);await showRow();
    expect(host.textContent).toContain('Record the subcontractor application in Stage 1');expect(button('Record claim this application')).toBeUndefined();
  });
  it('does not offer claim writes without create permission',async()=>{
    mocks.permissions=new Set(['variation_account.assess']);await showRow();expect(button('Record claim this application')).toBeUndefined();
  });
  it('does not expose claim writes for a locked certificate even if editable is passed',async()=>{
    host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
    mocks.assessments.mockResolvedValue({items:[{...item,previousCertified:1000}]});
    await act(async()=>root.render(<PaymentCertificateVariationsWorkspace packageId="pkg-1" certificate={{...certificate,status:'locked'}} editable/>));await settle();
    expect(button('Record claim this application')).toBeUndefined();
  });
});

describe('VA claim display and permission boundaries',()=>{
  beforeEach(()=>{
    mocks.lines.mockResolvedValue([]);mocks.candidates.mockResolvedValue({candidates:[]});
    mocks.account.mockResolvedValue([{id:'va-1',reference:'VA-0001',status:'active',description:'Pipework'}]);
    mocks.assessments.mockResolvedValue({items:[{variationAccountItemId:'va-1',reference:'VA-0001',description:'Pipework',contractorValue:8500,qsForecast:6200,previousCertified:0,assessment:{currentAssessment:6200,cumulativeCertified:6200}}]});
  });
  it('allows claim recording with create permission without granting assessment permission',async()=>{
    mocks.permissions=new Set(['variation_account.create']);await render();
    expect(button('Record claim this application')).toBeDefined();
    expect(host.querySelector('[aria-label="VA-0001 QS assessment this certificate"]')).toBeNull();
  });
  it('shows missing claim distinctly from an explicitly recorded zero',async()=>{
    await render();expect(host.textContent).toContain('Application claim not recorded');
    expect(host.querySelector('tbody tr').textContent).toContain('Not available');
    mocks.lines.mockResolvedValue([{id:'zero',variationAccountItemId:'va-1',currentClaim:0,cumulativeClaim:0}]);
    await act(async()=>root.render(<PaymentCertificateVariationsWorkspace packageId="pkg-1" certificate={{...certificate,version:2}} editable/>));await settle();
    expect(host.textContent).toContain('Current claim \u00a30.00');expect(host.textContent).not.toContain('Application claim not recorded');
  });
});
