/**
 * BL-032A — Development revenue settings API client.
 */

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(
  /\/+$/,
  ''
);

const buildUrl = (path) => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export class RevenueSettingsApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Revenue settings API request failed');
    this.name = 'RevenueSettingsApiError';
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
    throw new RevenueSettingsApiError(body?.message || res.statusText || 'Request failed', {
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

function settingsUrl(developmentId) {
  return `/api/developments/${encodeURIComponent(developmentId)}/revenue/settings`;
}

export async function getRevenueSettingsForDevelopment(developmentId) {
  const res = await fetch(buildUrl(settingsUrl(developmentId)));
  return handleJson(res);
}

export async function putRevenueSettingsForDevelopment(developmentId, payload = {}) {
  const res = await fetch(buildUrl(settingsUrl(developmentId)), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}
