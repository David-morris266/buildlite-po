/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list:vi.fn(),review:vi.fn() }));
vi.mock('../api/variationOrders', () => ({
  approveAndIssueVariationOrder:vi.fn(),listDirectVariationOrderOverlaps:mocks.list,
  reviewDirectVariationOrderOverlaps:mocks.review,submitVariationOrder:vi.fn(),updateVariationOrder:vi.fn(),
}));
vi.mock('../admin/companyStore', () => ({ getCompanySettings: () => ({ companyName:'Test Company' }) }));
vi.mock('../admin/costCodeMasterStore', () => ({ listActiveCostCodesForSelect:vi.fn(async()=>[]) }));
vi.mock('../commercial/commercialEvents', () => ({ notifyCommercialChanged:vi.fn() }));
vi.mock('./PrelimsCostCodePicker', () => ({ default:() => null }));
vi.mock('./PODrawerShell', () => ({ default:({children}) => <div>{children}</div> }));
import VariationOrderDrawer from './VariationOrderDrawer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vo={id:'vo-1',packageId:'package-1',status:'approved',version:3,sourcePoNumber:'S0001',supplierLabel:'Supplier',developmentName:'Development',description:'Direct instruction',vatTreatment:'inherit',retentionTreatment:'inherit',lines:[{id:'line-1',costCodeId:'code-1',costCode:'5000',description:'Work',netValue:750}],sourceCommercialEvents:[],sourceLineAllocations:[],audit:[],termsOverride:{directInstruction:{schemaVersion:'direct_vo_v1',treatment:'independent'}}};
const button=(host,label)=>[...host.querySelectorAll('button')].find(item=>item.textContent===label);
function inputValue(element,value){Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));}

describe('VariationOrderDrawer direct overlap re-review',()=>{
  afterEach(()=>{vi.clearAllMocks();document.body.innerHTML='';});
  it('requires visible current evidence and acknowledgement before saving the re-review',async()=>{
    mocks.list.mockResolvedValue({records:[{type:'commercial_event',id:'ce-2',reference:'CE-0002',status:'submitted'}]});
    mocks.review.mockResolvedValue({...vo,status:'submitted',approvedAt:null,approvedBy:null,version:4,audit:[{id:'approval-1',action:'approve'},{id:'audit-1',action:'overlap_reviewed',priorStatus:'approved',newStatus:'submitted'}]});
    const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
    await act(async()=>root.render(<VariationOrderDrawer open variationOrder={vo} onClose={()=>{}}/>));
    await act(async()=>button(host,'Review current overlaps').click());
    expect(host.textContent).toContain('CE-0002');
    const save=button(host,'Save overlap re-review');expect(save.disabled).toBe(true);
    const reviewLabel=[...host.querySelectorAll('label')].find(label=>label.textContent.includes('Re-review reason'));
    await act(async()=>{inputValue(reviewLabel.querySelector('textarea'), 'Reviewed the new CE as separate instructed work');host.querySelector('input[type="checkbox"]').click();});
    expect(button(host,'Save overlap re-review').disabled).toBe(false);
    await act(async()=>button(host,'Save overlap re-review').click());
    expect(mocks.review).toHaveBeenCalledWith('vo-1',{version:3,reason:'Reviewed the new CE as separate instructed work',reviewedEvidence:[{type:'commercial_event',id:'ce-2'}]});
    expect(host.textContent).toContain('Submitted');
    await act(async()=>root.unmount());
  });
});
