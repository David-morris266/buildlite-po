/**
 * BL-027A.2 — Development server API client.
 */

const API_BASE = (
  import.meta.env.VITE_API_URL || 'http://localhost:3001'
).replace(/\/+$/, '');

const buildUrl = (path) =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export class DevelopmentApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Development API request failed');
    this.name = 'DevelopmentApiError';
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
    throw new DevelopmentApiError(body?.message || res.statusText || 'Request failed', {
      status: res.status,
      body,
    });
  }
  return body;
}

function sessionActor() {
  if (typeof localStorage === 'undefined') return null;
  return (
    localStorage.getItem('userName') ||
    localStorage.getItem('userEmail') ||
    null
  );
}

export async function listDevelopments() {
  const res = await fetch(buildUrl('/api/developments'));
  const data = await handleJson(res);
  return Array.isArray(data) ? data : [];
}

export async function getDevelopment(id) {
  const res = await fetch(buildUrl(`/api/developments/${encodeURIComponent(id)}`));
  return handleJson(res);
}

export async function createDevelopment(payload = {}) {
  const actor = sessionActor();
  const res = await fetch(buildUrl('/api/developments'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      ...(actor ? { createdBy: actor, updatedBy: actor } : {}),
    }),
  });
  return handleJson(res);
}

export async function updateDevelopment(id, payload = {}) {
  const actor = sessionActor();
  const res = await fetch(buildUrl(`/api/developments/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      ...(actor ? { updatedBy: actor } : {}),
    }),
  });
  return handleJson(res);
}
