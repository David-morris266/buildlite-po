import { enrichPoWithDevelopmentRef, enrichPosWithDevelopmentRefs } from './developments/poDevelopmentRefStore';

// API base URL from VITE_API_URL (Netlify/staging) with localhost fallback for dev.
const API_BASE = (
  import.meta.env.VITE_API_URL || 'http://localhost:3001'
).replace(/\/+$/, '');

const buildUrl = (path) =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

async function handleJson(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || res.statusText || 'Request failed');
  }
  return res.json();
}

/* ---------- Suppliers ---------- */
// NOTE: use /api/po/suppliers to match poRoutes.js
export async function listSuppliers(q = '') {
  const url = q
    ? buildUrl(`/api/po/suppliers?q=${encodeURIComponent(q)}`)
    : buildUrl('/api/po/suppliers');
  const res = await fetch(url);
  return handleJson(res);
}

export async function createSupplier(body = {}) {
  const url = buildUrl('/api/po/suppliers');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleJson(res);
}

export async function updateSupplier(id, body = {}) {
  const url = buildUrl(`/api/po/suppliers/${encodeURIComponent(id)}`);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleJson(res);
}

/** Create supplier or return existing record when name already exists (409). */
export async function createOrGetSupplier(body = {}) {
  const url = buildUrl('/api/po/suppliers');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    const suppliers = await listSuppliers('');
    const name = String(body.name || '').trim().toLowerCase();
    const existing = (suppliers || []).find(
      (s) => String(s.name || '').trim().toLowerCase() === name
    );
    if (existing) return existing;
  }

  return handleJson(res);
}

/* ---------- Jobs ---------- */
export async function listJobs(q = '') {
  const url = q
    ? buildUrl(`/api/jobs?q=${encodeURIComponent(q)}`)
    : buildUrl('/api/jobs');
  const res = await fetch(url);
  return handleJson(res);
}

export async function getJob(id) {
  const url = buildUrl(`/api/jobs/${encodeURIComponent(id)}`);
  const res = await fetch(url);
  return handleJson(res);
}

export async function createJob(body = {}) {
  const url = buildUrl('/api/jobs');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleJson(res);
}

/** Create job or return existing record matched by name or code. */
export async function createOrGetJob(body = {}) {
  const name = String(body.name || '').trim().toLowerCase();
  const code = String(body.jobCode || body.jobNumber || '')
    .trim()
    .toLowerCase();

  if (name || code) {
    const jobs = await listJobs('');
    const existing = (jobs || []).find((job) => {
      const jobName = String(job.name || '').trim().toLowerCase();
      const jobCode = String(job.jobCode || job.jobNumber || '')
        .trim()
        .toLowerCase();
      if (name && jobName === name) return true;
      if (code && jobCode === code) return true;
      return false;
    });
    if (existing) return existing;
  }

  return createJob(body);
}

/* ---------- Cost Codes ---------- */
export async function listCostCodes(params = '') {
  const query =
    typeof params === 'string'
      ? params
      : new URLSearchParams(params || {}).toString();

  const url = buildUrl(`/api/po/cost-codes${query ? `?${query}` : ''}`);
  const res = await fetch(url);
  return handleJson(res);
}

/* ---------- POs (list / read / save) ---------- */
export async function listPOs(params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = buildUrl(`/api/po${query ? `?${query}` : ''}`);
  const res = await fetch(url);
  const data = await handleJson(res);
  if (Array.isArray(data)) return enrichPosWithDevelopmentRefs(data);
  if (data?.items) {
    return { ...data, items: enrichPosWithDevelopmentRefs(data.items) };
  }
  return data;
}

export async function getPO(number) {
  const url = buildUrl(`/api/po/${encodeURIComponent(number)}`);
  const res = await fetch(url);
  const po = await handleJson(res);
  return enrichPoWithDevelopmentRef(po);
}

export async function deletePO(number) {
  const url = buildUrl(`/api/po/${encodeURIComponent(number)}`);
  const res = await fetch(url, { method: 'DELETE' });
  return handleJson(res);
}

/** Create a new PO (POST /api/po) */
export async function savePO(body = {}) {
  const url = buildUrl('/api/po');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleJson(res);
}

/** Update an existing PO (PUT /api/po/:poNumber) */
export async function updatePO(poNumber, body = {}) {
  const url = buildUrl(`/api/po/${encodeURIComponent(poNumber)}`);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleJson(res);
}

/* ---------- Approvals ---------- */

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

/* ---------- PO PDF helper ---------- */

export function poPdfUrl(number) {
  return buildUrl(`/api/po/${encodeURIComponent(number)}/pdf`);
}

/* ---------- Brand ---------- */
export async function getActiveBrand() {
  const res = await fetch(buildUrl("/api/brand/active"));
  return handleJson(res);
}
