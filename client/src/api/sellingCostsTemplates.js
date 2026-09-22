const API_BASE=(import.meta.env.VITE_API_URL||'http://localhost:3001').replace(/\/+$/,'');
async function request(path,options){const response=await fetch(`${API_BASE}${path}`,options);const body=await response.json().catch(()=>null);if(!response.ok)throw new Error(body?.message||'Selling Costs template request failed.');return body;}
export const getStandardSellingCostsTemplate=()=>request('/api/selling-costs-templates/standard');
export const listSellingCostsTemplates=async()=>({templates:await request('/api/selling-costs-templates')});
export const getSellingCostsTemplate=(id)=>request(`/api/selling-costs-templates/${encodeURIComponent(id)}`);
export const createSellingCostsTemplate=(payload)=>request('/api/selling-costs-templates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
export const updateSellingCostsTemplate=(id,payload)=>request(`/api/selling-costs-templates/${encodeURIComponent(id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
