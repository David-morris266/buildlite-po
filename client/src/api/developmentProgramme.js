/**
 * BL-033C — Development programme API client.
 */

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(
  /\/+$/,
  ''
);

const buildUrl = (path) => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export class DevelopmentProgrammeApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Development programme API request failed');
    this.name = 'DevelopmentProgrammeApiError';
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
    throw new DevelopmentProgrammeApiError(body?.message || res.statusText || 'Request failed', {
      status: res.status,
      body,
    });
  }
  return body;
}

function programmeUrl(developmentId) {
  return `/api/developments/${encodeURIComponent(developmentId)}/programme`;
}

export async function getDevelopmentProgramme(developmentId) {
  const res = await fetch(buildUrl(programmeUrl(developmentId)));
  return handleJson(res);
}

export async function putDevelopmentProgramme(developmentId, payload = {}) {
  const res = await fetch(buildUrl(programmeUrl(developmentId)), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson(res);
}
