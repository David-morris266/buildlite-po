/**
 * @vitest-environment jsdom
 */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

describe('authenticated API transport',()=>{
  let values;
  beforeEach(()=>{values=new Map();vi.stubGlobal('localStorage',{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),clear:()=>values.clear()});});
  afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();});

  it('attaches the Clerk bearer token and selected tenant only to the BuildLite API',async()=>{
    const native=vi.fn().mockResolvedValue(new Response('{}',{status:200}));
    vi.stubGlobal('fetch',native);
    localStorage.setItem('buildlite_active_client_id','client-a');
    const {configureAuthenticatedFetch}=await import('./authenticatedFetch.js');
    configureAuthenticatedFetch(async()=>'token-1');
    await fetch('http://localhost:3001/api/auth/me');
    const init=native.mock.calls[0][1];
    expect(init.headers.get('Authorization')).toBe('Bearer token-1');
    expect(init.headers.get('X-BuildLite-Client-Id')).toBe('client-a');
  });

  it('does not leak BuildLite credentials to another origin',async()=>{
    const native=vi.fn().mockResolvedValue(new Response('{}',{status:200}));
    vi.stubGlobal('fetch',native);
    const {configureAuthenticatedFetch}=await import('./authenticatedFetch.js');
    configureAuthenticatedFetch(async()=>'token-1');
    await fetch('https://example.test/data');
    expect(native).toHaveBeenCalledWith('https://example.test/data',{});
  });

  it('downloads a PDF through the authenticated tenant-aware transport and cleans up its object URL',async()=>{
    vi.useFakeTimers();
    const native=vi.fn().mockResolvedValue(new Response('pdf',{status:200,headers:{'Content-Type':'application/pdf'}}));
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{}),revokeObjectURL=vi.fn();
    vi.stubGlobal('fetch',native);
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>'blob:po-pdf')});
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revokeObjectURL});
    localStorage.setItem('buildlite_active_client_id','willow');
    const {configureAuthenticatedFetch,authenticatedBlob}=await import('./authenticatedFetch.js');
    configureAuthenticatedFetch(async()=>'token-1');
    await authenticatedBlob('http://localhost:3001/api/po/S0001/pdf',{downloadName:'S0001.pdf',expectedContentType:'application/pdf'});
    expect(native.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer token-1');
    expect(native.mock.calls[0][1].headers.get('X-BuildLite-Client-Id')).toBe('willow');
    expect(click).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:po-pdf');
    vi.useRealTimers();
  });

  it('surfaces safe JSON errors and rejects a non-PDF success response',async()=>{
    vi.stubGlobal('fetch',vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({message:'Select an authorized company for this request.'}),{status:409,headers:{'Content-Type':'application/json'}}))
      .mockResolvedValueOnce(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})));
    const {authenticatedBlob}=await import('./authenticatedFetch.js');
    await expect(authenticatedBlob('http://localhost:3001/api/po/S0001/pdf',{expectedContentType:'application/pdf'}))
      .rejects.toThrow('Select an authorized company for this request.');
    await expect(authenticatedBlob('http://localhost:3001/api/po/S0001/pdf',{expectedContentType:'application/pdf'}))
      .rejects.toThrow('The server did not return the expected document.');
  });
});
