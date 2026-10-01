const API_BASE=(import.meta.env.VITE_API_URL||'http://localhost:3001').replace(/\/$/,'');
async function call(path,options){const response=await fetch(`${API_BASE}/api/memberships${path}`,options),body=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(body.message||'Membership administration failed.');error.code=body.code;throw error;}return body;}
export const loadMembershipAdministration=()=>call('');
export const inviteTenantMember=payload=>call('/invitations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
export const cancelTenantInvitation=(id,version)=>call(`/invitations/${id}/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version})});
export const updateTenantMember=(id,payload)=>call(`/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
