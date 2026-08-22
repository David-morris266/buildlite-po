/**
 * BL-033D.x.1 — Company Prelims templates API client.
 */

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(
  /\/+$/,
  ''
);

const buildUrl = (path) => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export class PrelimsTemplateApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Prelims template API request failed');
    this.name = 'PrelimsTemplateApiError';
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
    throw new PrelimsTemplateApiError(body?.message || res.statusText || 'Request failed', {
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

export async function getBuildLiteStandardPrelimsTemplate() {
  const res = await fetch(buildUrl('/api/prelims-templates/standard'));
  return handleJson(res);
}

export async function listPrelimsTemplates() {
  const res = await fetch(buildUrl('/api/prelims-templates'));
  return handleJson(res);
}

export async function getPrelimsTemplate(templateId) {
  const res = await fetch(buildUrl(`/api/prelims-templates/${encodeURIComponent(templateId)}`));
  return handleJson(res);
}

export async function createPrelimsTemplate(payload = {}) {
  const res = await fetch(buildUrl('/api/prelims-templates'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function updatePrelimsTemplate(templateId, payload = {}) {
  const res = await fetch(buildUrl(`/api/prelims-templates/${encodeURIComponent(templateId)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function createPrelimsTemplateLine(templateId, payload = {}) {
  const res = await fetch(
    buildUrl(`/api/prelims-templates/${encodeURIComponent(templateId)}/lines`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withActor(payload)),
    }
  );
  return handleJson(res);
}

export async function updatePrelimsTemplateLine(templateId, lineId, payload = {}) {
  const res = await fetch(
    buildUrl(
      `/api/prelims-templates/${encodeURIComponent(templateId)}/lines/${encodeURIComponent(lineId)}`
    ),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withActor(payload)),
    }
  );
  return handleJson(res);
}
