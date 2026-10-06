import { recordAuthTiming, timingStart } from './authTiming';

const API_BASE=(import.meta.env.VITE_API_URL||'http://localhost:3001').replace(/\/+$/,'');
let tokenProvider=null;
let installed=false;
let nativeFetch=null;

export function configureAuthenticatedFetch(getToken){
  tokenProvider=getToken;
  if(installed||typeof globalThis.fetch!=='function')return;
  installed=true; nativeFetch=globalThis.fetch.bind(globalThis);
  globalThis.fetch=async(input,init={})=>{
    const raw=typeof input==='string'?input:input?.url||'';
    if(!raw.startsWith(API_BASE))return nativeFetch(input,init);
    const recordTokenTiming=raw.endsWith('/api/auth/me')||raw.endsWith('/api/auth/readiness');
    const tokenStarted=recordTokenTiming?timingStart():null;
    const token=await tokenProvider?.();
    if(recordTokenTiming)recordAuthTiming('clerk_token_acquisition',tokenStarted);
    const headers=new Headers(init.headers||(typeof input!=='string'?input.headers:undefined));
    if(token)headers.set('Authorization',`Bearer ${token}`);
    const clientId=globalThis.localStorage?.getItem('buildlite_active_client_id');
    if(clientId)headers.set('X-BuildLite-Client-Id',clientId);
    const response=await nativeFetch(input,{...init,headers});
    if(response.status===401||response.status===403)globalThis.dispatchEvent?.(new CustomEvent('buildlite:authorization-error',{detail:{status:response.status}}));
    return response;
  };
}

export async function authenticatedBlob(url,{downloadName,expectedContentType}={}){
  const response=await fetch(url);
  const contentType=String(response.headers.get('Content-Type')||'').toLowerCase();
  if(!response.ok){
    const body=contentType.includes('application/json')?await response.json().catch(()=>({})):{};
    throw new Error(body.message||(response.status===403?'You do not have permission to view this document.':'Document could not be loaded.'));
  }
  if(expectedContentType&&!contentType.includes(String(expectedContentType).toLowerCase())){
    throw new Error('The server did not return the expected document.');
  }
  const blob=await response.blob(),objectUrl=URL.createObjectURL(blob);
  if(downloadName){const link=document.createElement('a');link.href=objectUrl;link.download=downloadName;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);return;}
  window.open(objectUrl,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
}
