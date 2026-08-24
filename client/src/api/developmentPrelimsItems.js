/**
 * BL-033D.1 — Development Prelims items API client.
 */

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(
  /\/+$/,
  ''
);

const buildUrl = (path) => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export class DevelopmentPrelimsApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Development Prelims API request failed');
    this.name = 'DevelopmentPrelimsApiError';
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
    throw new DevelopmentPrelimsApiError(body?.message || res.statusText || 'Request failed', {
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

function collectionUrl(developmentId, reportingMonth) {
  const base = `/api/developments/${encodeURIComponent(developmentId)}/prelims-items`;
  if (!reportingMonth) return base;
  return `${base}?reportingMonth=${encodeURIComponent(reportingMonth)}`;
}

function itemUrl(developmentId, itemId, reportingMonth) {
  const base = `/api/developments/${encodeURIComponent(developmentId)}/prelims-items/${encodeURIComponent(itemId)}`;
  if (!reportingMonth) return base;
  return `${base}?reportingMonth=${encodeURIComponent(reportingMonth)}`;
}

export async function listDevelopmentPrelimsItems(developmentId, { reportingMonth } = {}) {
  const res = await fetch(buildUrl(collectionUrl(developmentId, reportingMonth)));
  return handleJson(res);
}

export async function createDevelopmentPrelimsItem(developmentId, payload = {}) {
  const res = await fetch(buildUrl(collectionUrl(developmentId)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function updateDevelopmentPrelimsItem(developmentId, itemId, payload = {}) {
  const res = await fetch(buildUrl(itemUrl(developmentId, itemId)), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function previewDevelopmentPrelimsSetup(
  developmentId,
  { templateId, reportingMonth } = {}
) {
  const params = new URLSearchParams();
  if (templateId) params.set('templateId', templateId);
  if (reportingMonth) params.set('reportingMonth', reportingMonth);
  const query = params.toString();
  const path = `/api/developments/${encodeURIComponent(developmentId)}/prelims-setup/preview${
    query ? `?${query}` : ''
  }`;
  const res = await fetch(buildUrl(path));
  return handleJson(res);
}

export async function applyDevelopmentPrelimsSetup(developmentId, payload = {}) {
  const res = await fetch(
    buildUrl(`/api/developments/${encodeURIComponent(developmentId)}/prelims-setup/apply`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withActor(payload)),
    }
  );
  return handleJson(res);
}

/** BL-033D.x.4B — Read-only Prelims vs CVR commercial review (no adoption write). */
export async function previewDevelopmentPrelimsAdoption(
  developmentId,
  { reportingMonth } = {}
) {
  const params = new URLSearchParams();
  if (reportingMonth) params.set('reportingMonth', reportingMonth);
  const query = params.toString();
  const path = `/api/developments/${encodeURIComponent(developmentId)}/prelims-adoption/preview${
    query ? `?${query}` : ''
  }`;
  const res = await fetch(buildUrl(path));
  return handleJson(res);
}
