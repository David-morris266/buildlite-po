// @vitest-environment jsdom
import React from 'react';
import {createRoot} from 'react-dom/client';
import {act} from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../auth/BuildLiteAuthProvider',()=>({useBuildLitePermission:()=>true}));
vi.mock('../api/paymentApplications',()=>({listApplicationVariations:vi.fn(),listPackageVariationAccount:vi.fn(),addApplicationVariation:vi.fn(),matchApplicationVariation:vi.fn(),createVariationFromApplication:vi.fn(),confirmApplicationContractorPosition:vi.fn()}));
import * as api from '../api/paymentApplications';
import PaymentApplicationVariations from './PaymentApplicationVariations';

let container;
const application={id:'app-1',revisionNumber:1,currentPeriodGrossClaimed:15000,comparison:{applicationCurrentGross:15000}};
beforeEach(()=>{api.listPackageVariationAccount.mockResolvedValue([{id:'va-1',reference:'VA-0001',description:'Drainage design changes'}]);api.listApplicationVariations.mockResolvedValue([{id:'line-1',contractorReference:'GW-01',description:'Drainage design changes',contractorValue:20000,previousClaim:0,currentClaim:10000,cumulativeClaim:10000,reconciliationState:'unresolved'}]);});
afterEach(()=>{container?.remove();container=null;vi.clearAllMocks();});
async function render(){container=document.createElement('div');document.body.append(container);await act(async()=>{createRoot(container).render(<PaymentApplicationVariations packageId="pkg" application={application} editable/>);await Promise.resolve();});return container;}
describe('PaymentApplicationVariations',()=>{
  it('shows contractor claim separately from residual application gross',async()=>{const node=await render();expect(node.textContent).toContain('£20,000.00');expect(node.textContent).toContain('£10,000.00');expect(node.textContent).toContain('£5,000.00');expect(node.textContent).toContain('Unresolved');});
  it('manually matches an existing VA item',async()=>{api.matchApplicationVariation.mockResolvedValue({});const node=await render();const select=node.querySelector('tbody select');await act(async()=>{select.value='va-1';select.dispatchEvent(new Event('change',{bubbles:true}));});const button=[...node.querySelectorAll('button')].find(x=>x.textContent==='Match existing');await act(async()=>{button.click();await Promise.resolve();});expect(api.matchApplicationVariation).toHaveBeenCalledWith('pkg','app-1','line-1','va-1');});
});
