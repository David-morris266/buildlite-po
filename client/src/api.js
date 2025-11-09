// client/src/api.js

// Determine API base URL
// - In production: set VITE_API_BASE_URL in Netlify env (e.g. https://buildlite-po-backend.onrender.com)
// - In dev: falls back to http://localhost:3001
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  'http://localhost:3001'
).replace(/\/+$/, ''); // strip trailing slash just in case

const buildUrl = (path) => {
  // ensure exactly one slash between base and path
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
};

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
