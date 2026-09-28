/** @vitest-environment jsdom */
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({provision:vi.fn(),refresh:vi.fn()}));
vi.mock('../../api/platformProvisioning',()=>({provisionCompany:mocks.provision}));
vi.mock('../../auth/BuildLiteAuthProvider',()=>({useBuildLitePrincipal:()=>({refreshPrincipal:mocks.refresh})}));
import AdminPlatformProvisioningPage from './AdminPlatformProvisioningPage';

let container,root;
describe('assisted company provisioning',()=>{
  beforeEach(()=>{container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);mocks.provision.mockReset();mocks.refresh.mockReset();});
  afterEach(()=>{act(()=>root.unmount());container.remove();});
  it('requires explicit company and existing-user identity and provisions once through platform authority',async()=>{
    mocks.provision.mockResolvedValue({tenant:{id:'tenant-willow',name:'Willow Rehearsal'},membership:{roleName:'Commercial Director'}});
    await act(async()=>root.render(<AdminPlatformProvisioningPage onBack={()=>{}}/>));
    const inputs=container.querySelectorAll('input');
    const setValue=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
    await act(async()=>{setValue(inputs[0],'Willow Rehearsal');setValue(inputs[1],'willow_rehearsal');setValue(inputs[2],'owner@example.test');});
    await act(async()=>container.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(mocks.provision).toHaveBeenCalledTimes(1);
    expect(mocks.provision.mock.calls[0][0]).toMatchObject({tenantName:'Willow Rehearsal',tenantCode:'willow_rehearsal',initialUserEmail:'owner@example.test',initialRoleKey:'commercial_director'});
    expect(mocks.refresh).toHaveBeenCalled();
    expect(container.textContent).toContain('Willow Rehearsal provisioned');
  });
});
