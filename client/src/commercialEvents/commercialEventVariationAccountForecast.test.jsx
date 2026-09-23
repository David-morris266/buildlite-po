/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommercialEventDrawer from '../components/CommercialEventDrawer';

const order={developmentId:'dev-hawthorn',orderKey:'dev-hawthorn::jm-civils::3100',packageUuid:'6068ee46-e3c2-4a10-9da4-1aabd27ed0e0',supplierId:'jm-civils',costCode:'3100',poNumbers:['PO-JM-01']};
const submitted={id:'ce-hg-002',eventNumber:'CE-HG002',developmentId:order.developmentId,packageId:order.orderKey,orderKey:order.orderKey,packageUuid:order.packageUuid,eventType:'variation',category:'commercial',subcategory:'scopeChange',responsibility:'commercial',description:'Additional muck-away risk',value:20000,financialTreatment:'contractAmendment',vatTreatment:'standard',dateRaised:'2027-02-01',status:'submitted',relationshipType:null,costCode:'3100',version:4,expectedTreatment:'override',expectedAmount:5000,expectedReason:'Current QS view',effectiveExpectedLiability:5000,auditHistory:[]};

let host;
let root;

async function renderEvent(event) {
  await act(async()=>{root.render(<CommercialEventDrawer open mode="view" event={event} order={order} onClose={()=>{}} onSaved={()=>{}} onOpenPackage={()=>{}}/>);await Promise.resolve();await Promise.resolve();});
}

describe('Submitted Commercial Event Variation Account forecast workflow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,statusText:'OK',json:async()=>({items:[]}),text:async()=>JSON.stringify([])}));
    host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
  });
  afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});

  it('posts only signed forecast and reason to the dedicated identity-retaining command', async () => {
    const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({item:{id:'va-1',reference:'VA-0001',sourceCommercialEventId:'ce-2',qsForecast:5000}})});
    const {createVariationAccountForecastFromCommercialEvent}=await import('../api/variationAccounts');
    const item=await createVariationAccountForecastFromCommercialEvent('ce-2',{qsForecast:-500,reason:'Signed credit forecast'});
    expect(item.sourceCommercialEventId).toBe('ce-2');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/variation-account/from-commercial-event/ce-2'),expect.objectContaining({method:'POST',body:JSON.stringify({qsForecast:-500,reason:'Signed credit forecast'})}));
  });

  it('renders the CE-HG002-shaped forward workflow inside the standard scrollable drawer body', async () => {
    await renderEvent(submitted);
    expect(host.textContent).toContain('Submitted');
    expect(host.textContent).toContain('Expected liability');
    expect(host.textContent).toContain('5,000.00');
    expect(host.textContent).toContain('Forecast in Variation Account');
    expect(host.textContent).toContain('Submitted event details are locked');
    expect(host.textContent).not.toContain('Approved events are immutable');
    expect(host.textContent).not.toContain('Update draft');
    const body=host.querySelector('[data-testid="commercial-event-drawer-body"]');
    const shell=host.querySelector('[data-testid="commercial-event-drawer-shell"]');
    expect(body.classList.contains('po-drawer-body')).toBe(true);
    expect(body.classList.contains('po-ce-drawer')).toBe(true);
    expect(shell.parentElement.classList.contains('po-drawer')).toBe(true);
    expect(body.parentElement).toBe(shell);
    expect(shell.querySelector('.po-ce-drawer__header--fixed')).not.toBeNull();
    const action=[...body.querySelectorAll('button')].find(button=>button.textContent==='Forecast in Variation Account');
    expect(action).toBeTruthy();
    await act(async()=>action.click());
    expect([...body.querySelectorAll('span')].some(span=>span.textContent==='QS Forecast')).toBe(true);
    expect([...body.querySelectorAll('span')].some(span=>span.textContent==='Reason')).toBe(true);
    expect([...body.querySelectorAll('button')].some(button=>button.textContent==='Create VA forecast')).toBe(true);
  });

  it('defines one explicit zero-minimum scroll owner beneath the fixed drawer header',async()=>{
    const css=readFileSync(resolve('src/styles/po-module.css'),'utf8');
    expect(css).toMatch(/\.po-ce-drawer-shell\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0;[^}]*display:\s*flex;/s);
    expect(css).toMatch(/\.po-ce-drawer__header--fixed\s*\{[^}]*flex:\s*0 0 auto;/s);
    expect(css).toMatch(/\.po-ce-drawer\s*\{[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s);
  });

  it.each([
    ['Draft',{...submitted,status:'draft'}],
    ['recovery',{...submitted,relationshipType:'recovery',financialTreatment:'recoverableDeduction'}],
    ['budget transfer',{...submitted,eventType:'budgetTransfer'}],
  ])('does not expose CE to VA creation for %s events',async(_label,event)=>{
    await renderEvent(event);
    expect(host.textContent).not.toContain('Forecast in Variation Account');
  });

  it('uses Approved-only reversal guidance for an Approved event',async()=>{
    await renderEvent({...submitted,status:'approved'});
    expect(host.textContent).toContain('Approved events are immutable. Create a reversing or correcting event to adjust committed value.');
    expect(host.textContent).not.toContain('Submitted event details are locked');
  });
});
