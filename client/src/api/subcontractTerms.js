const BASE=(import.meta.env.VITE_API_URL||'http://localhost:3001').replace(/\/+$/,'');
async function call(path,options={}){const response=await fetch(`${BASE}/api/subcontract-terms${path}`,{headers:{'Content-Type':'application/json'},...options});if(!response.ok)throw new Error((await response.json().catch(()=>null))?.message||'Request failed');return response.json();}
export const listSubcontractTerms=()=>call('/');
export const createSubcontractTerms=(body)=>call('/',{method:'POST',body:JSON.stringify(body)});
export const updateSubcontractTermsDraft=(id,body)=>call(`/versions/${id}`,{method:'PUT',body:JSON.stringify(body)});
export const publishSubcontractTerms=(id,body={})=>call(`/versions/${id}/publish`,{method:'POST',body:JSON.stringify(body)});
export const cloneSubcontractTerms=(id,body={})=>call(`/versions/${id}/clone`,{method:'POST',body:JSON.stringify(body)});
export const retireSubcontractTerms=(id,body={})=>call(`/versions/${id}/retire`,{method:'POST',body:JSON.stringify(body)});
export const setTenantSubcontractTermsDefault=(termsVersionId,body={})=>call('/default',{method:'PUT',body:JSON.stringify({...body,termsVersionId})});
