/**
 * BL-029B — Order Matrix server API client (BL-029A routes).
 */

const API_BASE = (
  import.meta.env.VITE_API_URL || 'http://localhost:3001'
).replace(/\/+$/, '');

const buildUrl = (path) =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export class OrderMatrixApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Order Matrix API request failed');
    this.name = 'OrderMatrixApiError';
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
    throw new OrderMatrixApiError(body?.message || res.statusText || 'Request failed', {
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

export async function listMatricesForDevelopment(developmentId) {
  const res = await fetch(
    buildUrl(`/api/developments/${encodeURIComponent(developmentId)}/matrices`)
  );
  const data = await handleJson(res);
  return Array.isArray(data) ? data : [];
}

export async function getMatrixByPackageId(packageId) {
  const res = await fetch(
    buildUrl(`/api/packages/${encodeURIComponent(packageId)}/matrix`)
  );
  return handleJson(res);
}

export async function getMatrixByOrderKey(orderKey) {
  const res = await fetch(
    buildUrl(`/api/packages/by-order-key/${encodeURIComponent(orderKey)}/matrix`)
  );
  return handleJson(res);
}

/** Reserved for BL-029D — not wired to runtime saves in BL-029B. */
export async function putMatrixForPackage(packageId, payload = {}) {
  const res = await fetch(
    buildUrl(`/api/packages/${encodeURIComponent(packageId)}/matrix`),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withActor(payload)),
    }
  );
  return handleJson(res);
}
