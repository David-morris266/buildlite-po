// client/src/api.js

// Decide API base URL
// - On Netlify production we want the Render backend
// - On localhost dev we want http://localhost:3001

const RAW_ENV_BASE = import.meta.env.VITE_API_BASE_URL;

// If env var exists, use it. Otherwise:
//   - if we're on localhost: use local server
//   - otherwise: use the Render URL directly.
const API_BASE = (
  (RAW_ENV_BASE && RAW_ENV_BASE.trim()) ||
  (window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://buildlite-po-api.onrender.com')
).replace(/\/+$/, ''); // strip trailing slash

const buildUrl = (path) =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

async function handleJson(res) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText || 'Request failed');
  }
  return res.json();
}

/* ---------- Suppliers ---------- */
export async function listSuppliers(q = '') {
  const url = q
    ? buildUrl(`/api/suppliers?q=${encodeURIComponent(q)}`)
    : buildUrl('/api/suppliers');
  const res = await fetch(url);
  return handleJson(res); // array
}

/* ---------- Jobs ---------- */
export async function listJobs(q = '') {
  const url = q
    ? buildUrl(`/api/jobs?q=${encodeURIComponent(q)}`)
    : buildUrl('/api/jobs');
  const res = await fetch(url);
  return handleJson(res); // array
}

export async function getJob(id) {
  const url = buildUrl(`/api/jobs/${encodeURIComponent(id)}`);
  const res = await fetch(url);
  return handleJson(res); // object
}

/* ---------- Cost Codes ---------- */
export async function listCostCodes(params = '') {
  const query =
    typeof params === 'string'
      ? params
      : new URLSearchParams(params || {}).toString();

  const url = buildUrl(
    `/api/po/cost-codes${query ? `?${query}` : ''}`
  );
  const res = await fetch(url);
  return handleJson(res);
}

/* ---------- POs ---------- */
export async function listPOs(params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = buildUrl(`/api/po${query ? `?${query}` : ''}`);
  const res = await fetch(url);
  return handleJson(res); // { items: [...] } or array depending on server
}

export async function getPO(number) {
  const url = buildUrl(`/api/po/${encodeURIComponent(number)}`);
  const res = await fetch(url);
  return handleJson(res);
}

export async function deletePO(number) {
  const url = buildUrl(`/api/po/${encodeURIComponent(number)}`);
  const res = await fetch(url, { method: 'DELETE' });
  return handleJson(res);
}

export async function approvePO(number, body) {
  const url = buildUrl(`/api/po/${encodeURIComponent(number)}/approve`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return handleJson(res);
}

export async function requestApproval(number, body) {
  const url = buildUrl(
    `/api/po/${encodeURIComponent(number)}/request-approval`
  );
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return handleJson(res);
}
