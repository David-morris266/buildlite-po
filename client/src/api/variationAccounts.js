const API_BASE=(import.meta.env.VITE_API_URL||'http://localhost:3001').replace(/\/+$/,'');
async function json(response){const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||'Variation Account request failed.');return body;}
const base=id=>`${API_BASE}/api/variation-account/${encodeURIComponent(id)}`;
export async function listVariationAccount(packageId){const body=await json(await fetch(`${API_BASE}/api/variation-account?packageId=${encodeURIComponent(packageId)}`));return body.items||[];}
export async function listEligibleVariationAuthority(id){const body=await json(await fetch(`${base(id)}/eligible-authorities`));return body.sources||[];}
export async function allocateVariationAuthority(id,payload){const body=await json(await fetch(`${base(id)}/authority-allocations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));return body.projection;}
export async function appendVariationAuthoritySubstitution(id,payload){return json(await fetch(`${base(id)}/authority-substitutions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));}
export async function reverseVariationAuthority(id,allocationId,reason){const body=await json(await fetch(`${base(id)}/authority-allocations/${encodeURIComponent(allocationId)}/reverse`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})}));return body.projection;}
