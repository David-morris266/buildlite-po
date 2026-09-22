/**
 * BL-033B — Cost-code semantic classification API client.
 */

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(
  /\/+$/,
  ''
);

const buildUrl = (path) => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export class CostCodeClassificationApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Cost-code classification API request failed');
    this.name = 'CostCodeClassificationApiError';
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
    throw new CostCodeClassificationApiError(body?.message || res.statusText || 'Request failed', {
      status: res.status,
      body,
    });
  }
  return body;
}

function classificationUrl(costCodeKey) {
  return `/api/cost-code-classifications/${encodeURIComponent(costCodeKey)}`;
}

export async function listCostCodeClassifications() {
  const res = await fetch(buildUrl('/api/cost-code-classifications'));
  return handleJson(res);
}

export async function getCostCodeClassification(costCodeKey) {
  const res = await fetch(buildUrl(classificationUrl(costCodeKey)));
  return handleJson(res);
}

export async function putCostCodeClassification(costCodeKey, payload = {}) {
  const res = await fetch(buildUrl(classificationUrl(costCodeKey)), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson(res);
}

async function postBulk(path, payload) {
  const res = await fetch(buildUrl(`/api/cost-code-classifications/bulk/${path}`), {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload),
  });
  return handleJson(res);
}

export const previewBulkCostCodeClassifications = (payload) => postBulk('preview', payload);
export const applyBulkCostCodeClassifications = (payload) => postBulk('apply', payload);
