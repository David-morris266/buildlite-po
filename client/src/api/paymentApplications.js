const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
const url = (packageId, suffix = '') => `${API_BASE}/api/packages/${encodeURIComponent(packageId)}/payment-applications${suffix}`;

async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Subcontractor application request failed.');
  return body;
}

export async function listPaymentApplications(packageId, certificateId = null) {
  const query = certificateId ? `?certificateId=${encodeURIComponent(certificateId)}` : '';
  const body = await json(await fetch(url(packageId, query)));
  return Array.isArray(body.applications) ? body.applications : [];
}

export async function createPaymentApplication(packageId, body) {
  return json(await fetch(url(packageId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

export async function revisePaymentApplication(packageId, applicationId, body) {
  return json(await fetch(url(packageId, `/${encodeURIComponent(applicationId)}/revisions`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

export async function linkPaymentApplication(packageId, applicationId, certificateId) {
  return json(await fetch(url(packageId, `/${encodeURIComponent(applicationId)}/link`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ certificateId }) }));
}

const variationUrl=(packageId,applicationId,suffix='')=>url(packageId,`/${encodeURIComponent(applicationId)}/variation-lines${suffix}`);
export async function listApplicationVariations(packageId,applicationId){const body=await json(await fetch(variationUrl(packageId,applicationId)));return body.lines||[];}
export async function addApplicationVariation(packageId,applicationId,body){const result=await json(await fetch(variationUrl(packageId,applicationId),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));return result.line;}
export async function matchApplicationVariation(packageId,applicationId,lineId,variationAccountItemId){const result=await json(await fetch(variationUrl(packageId,applicationId,`/${encodeURIComponent(lineId)}/match`),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({variationAccountItemId})}));return result.line;}
export async function createVariationFromApplication(packageId,applicationId,lineId,body){return json(await fetch(variationUrl(packageId,applicationId,`/${encodeURIComponent(lineId)}/create-variation`),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));}
export async function confirmApplicationContractorPosition(packageId,applicationId,lineId,reason){return json(await fetch(variationUrl(packageId,applicationId,`/${encodeURIComponent(lineId)}/confirm-contractor-position`),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})}));}
export async function listPackageVariationAccount(packageId){const body=await json(await fetch(`${API_BASE}/api/variation-account?packageId=${encodeURIComponent(packageId)}`));return body.items||[];}
