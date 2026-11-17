// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({canEdit:true,save:vi.fn()}));
vi.mock('../auth/BuildLiteAuthProvider',()=>({useBuildLitePermission:()=>state.canEdit}));
vi.mock('../payments/paymentCertificateAuthority',()=>({isPaymentCertificateServerAuthorityEnabled:()=>true}));
vi.mock('../payments/paymentCertificateServerMutations',()=>({updateCertificateMetadataOnServer:state.save}));
import Confirmation from './PaymentCertificateZeroOrderedWorks';
let host,root;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{state.canEdit=true;state.save.mockReset().mockResolvedValue({ok:true});host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function render(props={}){await act(async()=>root.render(<Confirmation order={{orderKey:'order'}} certificate={{id:'cert',status:'draft',progress:{}}} matrixReady matrix={null} {...props}/>));}
it('requires an explicit checkbox and sends only the governed confirmation command',async()=>{
 const onChanged=vi.fn();await render({onChanged});expect(host.querySelector('button').disabled).toBe(true);
 await act(async()=>host.querySelector('input').click());await act(async()=>host.querySelector('button').click());
 expect(state.save).toHaveBeenCalledWith('order','cert',{zeroOrderedWorksConfirmed:true},{orderKey:'order'});expect(onChanged).toHaveBeenCalledTimes(1);
});
it.each([{matrixReady:false},{matrix:{id:'matrix'}},{certificate:{id:'cert',status:'draft',progress:{cell:0}}},{certificate:{id:'cert',status:'locked',progress:{}}}])('does not permit confirmation with unavailable or conflicting evidence',async props=>{
 await render(props);expect(host.querySelector('input').disabled).toBe(true);expect(host.querySelector('button').disabled).toBe(true);expect(state.save).not.toHaveBeenCalled();
});
it('preserves permission checks',async()=>{state.canEdit=false;await render();expect(host.querySelector('button')).toBeNull();expect(host.textContent).toContain('permission');});
it('shows a server rejection without replaying the command',async()=>{
 state.save.mockResolvedValue({ok:false,errors:['Previous ordered-work certification prevents this route.']});await render();
 await act(async()=>host.querySelector('input').click());await act(async()=>host.querySelector('button').click());
 expect(host.querySelector('[role="alert"]').textContent).toContain('Previous ordered-work');expect(state.save).toHaveBeenCalledTimes(1);
});
