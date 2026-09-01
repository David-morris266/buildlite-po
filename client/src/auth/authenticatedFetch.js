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
    const token=await tokenProvider?.();
    const headers=new Headers(init.headers||(typeof input!=='string'?input.headers:undefined));
    if(token)headers.set('Authorization',`Bearer ${token}`);
    const clientId=globalThis.localStorage?.getItem('buildlite_active_client_id');
    if(clientId)headers.set('X-BuildLite-Client-Id',clientId);
    const response=await nativeFetch(input,{...init,headers});
    if(response.status===401||response.status===403)globalThis.dispatchEvent?.(new CustomEvent('buildlite:authorization-error',{detail:{status:response.status}}));
    return response;
  };
}

export async function authenticatedBlob(url,{downloadName}={}){
  const response=await fetch(url);
  if(!response.ok)throw new Error(response.status===403?'You do not have permission to view this document.':'Document could not be loaded.');
  const blob=await response.blob(),objectUrl=URL.createObjectURL(blob);
  if(downloadName){const link=document.createElement('a');link.href=objectUrl;link.download=downloadName;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);return;}
  window.open(objectUrl,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
}
