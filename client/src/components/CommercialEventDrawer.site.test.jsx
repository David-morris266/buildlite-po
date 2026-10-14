/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommercialEventDrawer from './CommercialEventDrawer';

vi.mock('../auth/BuildLiteAuthProvider', () => ({
  useBuildLitePrincipal: () => ({ roleKey: 'site', permissions: ['commercial.read', 'ce.create'] }),
}));

const order={developmentId:'dev-site',orderKey:'subcontract:dev-site:supplier:1000',packageUuid:'6068ee46-e3c2-4a10-9da4-1aabd27ed0e0',supplierId:'supplier',costCode:'1000',poNumbers:['S0001']};
let host;
let root;

describe('Site Commercial Event origination',()=>{
  beforeEach(()=>{
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
});
