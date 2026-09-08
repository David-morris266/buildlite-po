// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permissions: new Set(['variation_account.create', 'variation_account.assess']),
  applications: vi.fn(), lines: vi.fn(), candidates: vi.fn(), account: vi.fn(), assessments: vi.fn(),
  add: vi.fn(), reconcile: vi.fn(), save: vi.fn(), withdraw: vi.fn(), refresh: vi.fn(),
}));
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: p => mocks.permissions.has(p) }));
vi.mock('../api/paymentApplications', () => ({
  listPaymentApplications: mocks.applications, listApplicationVariations: mocks.lines,
  listPackageVariationAccount: mocks.account, addApplicationVariation: mocks.add,
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
