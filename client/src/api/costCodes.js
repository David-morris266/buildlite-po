/**
 * BL-033D.x.2A.1 — Tenant Cost Code Master API client.
 */

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(
  /\/+$/,
  ''
);

const buildUrl = (path) => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export class CostCodeApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Cost code API request failed');
    this.name = 'CostCodeApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseResponseBody(res) {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function handleJson(res) {
  const body = await parseResponseBody(res);
  if (!res.ok) {
    throw new CostCodeApiError(body?.message || res.statusText || 'Request failed', {
      status: res.status,
      body,
    });
  }
  return body;
}

function sessionActor() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('userName') || localStorage.getItem('userEmail') || null;
}

function withActor(payload = {}) {
  const actor = sessionActor();
  if (!actor) return payload;
  return { ...payload, actor };
}

export async function listServerCostCodes({ activeOnly = false } = {}) {
  const query = activeOnly ? '?activeOnly=true' : '';
  const res = await fetch(buildUrl(`/api/cost-codes${query}`));
  return handleJson(res);
}

export async function getServerCostCode(id) {
  const res = await fetch(buildUrl(`/api/cost-codes/${encodeURIComponent(id)}`));
  return handleJson(res);
}

export async function createServerCostCode(payload = {}) {
  const res = await fetch(buildUrl('/api/cost-codes'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function updateServerCostCode(id, payload = {}) {
  const res = await fetch(buildUrl(`/api/cost-codes/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function setServerCostCodeActive(id, payload = {}) {
  const res = await fetch(buildUrl(`/api/cost-codes/${encodeURIComponent(id)}/active`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}
