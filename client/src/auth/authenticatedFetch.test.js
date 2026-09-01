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
});
