/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommercialEventDrawer from './CommercialEventDrawer';

const auth=vi.hoisted(()=>({principal:{roleKey:'site',permissions:['commercial.read','ce.create']}}));
vi.mock('../auth/BuildLiteAuthProvider', () => ({
  useBuildLitePrincipal: () => auth.principal,
}));

const order={developmentId:'dev-site',orderKey:'subcontract:dev-site:supplier:1000',packageUuid:'6068ee46-e3c2-4a10-9da4-1aabd27ed0e0',supplierId:'supplier',costCode:'1000',poNumbers:['S0001']};
let host;
let root;

describe('Site Commercial Event origination',()=>{
  beforeEach(()=>{
    auth.principal={roleKey:'site',permissions:['commercial.read','ce.create']};
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({items:[]}),text:async()=>JSON.stringify([])}));
    host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
  });
  afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});

  it('presents a basic Draft form without editable financial or Raised By controls',async()=>{
    await act(async()=>{root.render(<CommercialEventDrawer open mode="create" order={order} onClose={()=>{}} onSaved={()=>{}}/>);await Promise.resolve();await Promise.resolve();});
    expect(host.textContent).toContain('Commercial details');
    expect(host.textContent).not.toContain('Financial details');
    expect(host.textContent).not.toContain('Raised by');
    expect(host.querySelector('input[type="number"]')).toBeNull();
    const eventType=[...host.querySelectorAll('label')].find(label=>label.textContent.includes('Event type'))?.querySelector('select');
    expect(eventType?.disabled).toBe(true);
    expect([...host.querySelectorAll('button')].some(button=>button.textContent==='Save draft')).toBe(true);
  });

  it.each([
    ['Site principal',{roleKey:'site',permissions:['commercial.read','ce.create']}],
    ['missing principal',null],
  ])('fails closed for workflow and commercial decisions with a %s',async(_label,principal)=>{
    auth.principal=principal;
    const event={id:'ce-site-1',eventNumber:'CE-0001',status:'draft',eventType:'variation',category:'commercial',subcategory:'scopeChange',responsibility:'commercial',description:'Site event',value:0,dateRaised:'2026-10-14',raisedBy:'Site User',auditHistory:[]};
    await act(async()=>{root.render(<CommercialEventDrawer open mode="view" event={event} order={order} onEdit={()=>{}} onClose={()=>{}} onSaved={()=>{}}/>);await Promise.resolve();await Promise.resolve();});
    const text=host.textContent;
    expect(text).not.toContain('Submit');
    expect(text).not.toContain('Expected Liability');
    expect(text).not.toContain('Create Variation Order');
    expect(text).not.toContain('Create VA forecast');
    expect(text).not.toContain('Approve Commercial Event');
    expect(text).not.toContain('Edit draft');
  });

  it('retains Draft Edit for an authenticated commercial editor',async()=>{
    auth.principal={roleKey:'qs',permissions:['commercial.read','ce.edit','ce.submit']};
    const event={id:'ce-qs-1',eventNumber:'CE-0002',status:'draft',eventType:'variation',category:'commercial',subcategory:'scopeChange',responsibility:'commercial',description:'QS event',value:0,dateRaised:'2026-10-14',raisedBy:'QS User',auditHistory:[]};
    await act(async()=>{root.render(<CommercialEventDrawer open mode="view" event={event} order={order} onEdit={()=>{}} onClose={()=>{}} onSaved={()=>{}}/>);await Promise.resolve();await Promise.resolve();});
    expect(host.textContent).toContain('Edit draft');
  });
});
