/**
 * BL-028B.1 — Commercial Event server API client (BL-028A routes).
 */

const API_BASE = (
  import.meta.env.VITE_API_URL || 'http://localhost:3001'
).replace(/\/+$/, '');

const buildUrl = (path) =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export class CommercialEventApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Commercial Event API request failed');
    this.name = 'CommercialEventApiError';
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
    throw new CommercialEventApiError(body?.message || res.statusText || 'Request failed', {
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

function withActor(payload = {}) {
  const actor = sessionActor();
  if (!actor) return payload;
  return {
    ...payload,
    actor,
    createdBy: payload.createdBy ?? actor,
    updatedBy: payload.updatedBy ?? actor,
  };
}

export async function listCommercialEvents(filters = {}) {
  const params = new URLSearchParams();
  if (filters.developmentId) params.set('developmentId', filters.developmentId);
  if (filters.packageId) params.set('packageId', filters.packageId);
  if (filters.orderKey) params.set('orderKey', filters.orderKey);
  if (filters.status) params.set('status', filters.status);
  if (filters.relationshipType) params.set('relationshipType', filters.relationshipType);

  const query = params.toString();
  const res = await fetch(
    buildUrl(`/api/commercial-events${query ? `?${query}` : ''}`)
  );
  const data = await handleJson(res);
  return Array.isArray(data) ? data : [];
}

export async function getCommercialEvent(id) {
  const res = await fetch(
    buildUrl(`/api/commercial-events/${encodeURIComponent(id)}`)
  );
  return handleJson(res);
}

export async function createCommercialEvent(payload = {}) {
  const res = await fetch(buildUrl('/api/commercial-events'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function updateCommercialEvent(id, payload = {}) {
  const res = await fetch(buildUrl(`/api/commercial-events/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

async function postWorkflowAction(id, action, body = {}) {
  const res = await fetch(
    buildUrl(`/api/commercial-events/${encodeURIComponent(id)}/${action}`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withActor(body)),
    }
  );
  return handleJson(res);
}

export async function submitCommercialEvent(id, body = {}) {
  return postWorkflowAction(id, 'submit', body);
}

export async function approveCommercialEvent(id, body = {}) {
  return postWorkflowAction(id, 'approve', body);
}

export async function rejectCommercialEvent(id, body = {}) {
  return postWorkflowAction(id, 'reject', body);
}

export async function closeCommercialEvent(id, body = {}) {
  return postWorkflowAction(id, 'close', body);
}

export async function dismissPotentialContra(id, body = {}) {
  return postWorkflowAction(id, 'dismiss-potential-contra', body);
}

export async function createLinkedRecovery(id, body = {}) {
  const res = await fetch(
    buildUrl(`/api/commercial-events/${encodeURIComponent(id)}/create-linked-recovery`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withActor(body)),
    }
  );
  return handleJson(res);
}

/** UAT/admin import — not invoked during BL-028B.1 runtime. */
export async function importCommercialEvents(payload = {}) {
  const res = await fetch(buildUrl('/api/commercial-events/import'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson(res);
}
