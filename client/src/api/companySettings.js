const API=(import.meta.env.VITE_API_URL||'http://localhost:3001').replace(/\/+$/,'');
async function json(response){const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||'Company settings request failed.');return body;}
export async function getCompanySettings(){return json(await fetch(`${API}/api/company-settings`));}
export async function saveCompanySettings(settings,version){return json(await fetch(`${API}/api/company-settings`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings,version})}));}
export async function uploadCompanyLogo(file,version){return json(await fetch(`${API}/api/company-branding/logo`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-BuildLite-Branding-Version':String(version),'X-BuildLite-File-Name':encodeURIComponent(file.name||'company-logo')},body:file}));}
export async function removeCompanyLogo(version){return json(await fetch(`${API}/api/company-branding/logo`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({version})}));}
export async function loadCompanyLogo(displayUrl){const response=await fetch(`${API}${displayUrl}`);if(!response.ok)throw new Error('Company logo could not be loaded.');return response.blob();}
