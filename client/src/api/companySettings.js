const API=(import.meta.env.VITE_API_URL||'http://localhost:3001').replace(/\/+$/,'');
async function json(response){const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||'Company settings request failed.');return body;}
export async function getCompanySettings(){return json(await fetch(`${API}/api/company-settings`));}
export async function saveCompanySettings(settings,version){return json(await fetch(`${API}/api/company-settings`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings,version})}));}
