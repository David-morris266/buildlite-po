const API_BASE=(import.meta.env.VITE_API_URL||'http://localhost:3001').replace(/\/+$/,'');
async function json(response){const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||'Payment Authority request failed.');return body;}
export async function getPaymentApprovalQueue(){return (await json(await fetch(`${API_BASE}/api/payment-authority/queue`))).items||[];}
export async function approvePaymentAuthorityRun(payload){return json(await fetch(`${API_BASE}/api/payment-authority/runs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));}
export async function reversePaymentAuthority(id,payload){return json(await fetch(`${API_BASE}/api/payment-authority/decisions/${encodeURIComponent(id)}/reverse`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));}
