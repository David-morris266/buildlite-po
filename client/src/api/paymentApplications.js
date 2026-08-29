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
