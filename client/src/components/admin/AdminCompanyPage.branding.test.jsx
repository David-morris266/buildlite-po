/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({get:vi.fn(),save:vi.fn(),upload:vi.fn(),remove:vi.fn(),load:vi.fn(),cache:vi.fn()}));
vi.mock('../../api/companySettings',()=>({getCompanySettings:mocks.get,saveCompanySettings:mocks.save,uploadCompanyLogo:mocks.upload,removeCompanyLogo:mocks.remove,loadCompanyLogo:mocks.load}));
vi.mock('../../admin/companyStore',()=>({cacheAuthoritativeCompanySettings:mocks.cache,CVR_PERIOD_OPTIONS:['Monthly'],FORECAST_BEHAVIOUR_OPTIONS:['Committed']}));
import AdminCompanyPage from './AdminCompanyPage';

let container,root;
const settle=()=>act(async()=>{await Promise.resolve();await Promise.resolve();});
const settings={companyName:'Pilot Company',tradingName:'',companyNumber:'',vatRegistrationNumber:'',registeredOffice:'',website:'',currency:'GBP',financialYearStart:'04-01',vatRate:20,defaultRetentionPercent:5,defaultCvrPeriod:'Monthly',defaultForecastBehaviour:'Committed',numberingPrefixes:{}};

describe('authoritative Company branding UX',()=>{
  beforeEach(()=>{
    container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
    vi.stubGlobal('confirm',vi.fn(()=>true));
    vi.stubGlobal('URL',{...URL,createObjectURL:vi.fn(()=> 'blob:logo-preview'),revokeObjectURL:vi.fn()});
    mocks.get.mockReset().mockResolvedValue({settings,version:1,branding:{version:0,logo:null}});
    mocks.upload.mockReset().mockResolvedValue({version:1,logo:{id:'asset-1',mimeType:'image/webp',displayUrl:'/api/company-branding/assets/asset-1'}});
    mocks.remove.mockReset().mockResolvedValue({version:2,logo:null});mocks.load.mockReset().mockResolvedValue(new Blob(['logo'],{type:'image/webp'}));mocks.cache.mockReset();
  });
  afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});

  it('uses local pending preview, explicit save, authoritative preview and deliberate remove without a raw URL field',async()=>{
    await act(async()=>root.render(<AdminCompanyPage/>));await settle();
    act(()=>[...container.querySelectorAll('button')].find(x=>x.textContent==='Branding').click());
    expect(container.textContent).toContain('No logo uploaded');expect(container.textContent).not.toContain('Logo URL');
    const file=new File([new Uint8Array([137,80,78,71])],'pilot.png',{type:'image/png'}),input=container.querySelector('input[type=file]');
    await act(async()=>{Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(container.textContent).toContain('Unsaved preview');expect(mocks.upload).not.toHaveBeenCalled();
    await act(async()=>[...container.querySelectorAll('button')].find(x=>x.textContent==='Save logo').click());await settle();
    expect(mocks.upload).toHaveBeenCalledWith(file,0);expect(container.textContent).toContain('Company logo saved');expect(mocks.load).toHaveBeenCalled();
    await act(async()=>[...container.querySelectorAll('button')].find(x=>x.textContent==='Remove logo').click());await settle();
    expect(mocks.remove).toHaveBeenCalledWith(1);expect(container.textContent).toContain('Company logo removed');
  });

  it('retains the current saved logo when replacement validation fails',async()=>{
    mocks.get.mockResolvedValue({settings,version:1,branding:{version:3,logo:{id:'old',mimeType:'image/webp',displayUrl:'/api/company-branding/assets/old'}}});
    mocks.upload.mockRejectedValue(new Error('Company logo is malformed.'));
    await act(async()=>root.render(<AdminCompanyPage/>));await settle();act(()=>[...container.querySelectorAll('button')].find(x=>x.textContent==='Branding').click());await settle();
    const file=new File([new Uint8Array([1,2,3])],'bad.png',{type:'image/png'}),input=container.querySelector('input[type=file]');
    await act(async()=>{Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}));});
    await act(async()=>[...container.querySelectorAll('button')].find(x=>x.textContent==='Save logo').click());await settle();
    expect(container.textContent).toContain('Company logo is malformed');expect(mocks.remove).not.toHaveBeenCalled();expect(mocks.load).toHaveBeenCalledWith('/api/company-branding/assets/old');
  });
});
