/**
 * BL-027B.2 — Package server API client.
 */

const API_BASE = (
  import.meta.env.VITE_API_URL || 'http://localhost:3001'
).replace(/\/+$/, '');

const buildUrl = (path) =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export class PackageApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Package API request failed');
    this.name = 'PackageApiError';
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
    throw new PackageApiError(body?.message || res.statusText || 'Request failed', {
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

export async function listPackagesForDevelopment(developmentId) {
  const res = await fetch(
    buildUrl(`/api/developments/${encodeURIComponent(developmentId)}/packages`)
  );
  const data = await handleJson(res);
  return Array.isArray(data) ? data : [];
}

export async function getPackageById(packageId) {
  const res = await fetch(
    buildUrl(`/api/packages/${encodeURIComponent(packageId)}`)
  );
  return handleJson(res);
}

export async function getPackageByOrderKey(orderKey) {
  const res = await fetch(
    buildUrl(`/api/packages/by-order-key/${encodeURIComponent(orderKey)}`)
  );
  return handleJson(res);
}

export async function materialisePackages({ developmentId } = {}) {
  const actor = sessionActor();
  const res = await fetch(buildUrl('/api/packages/materialise'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(developmentId ? { developmentId } : {}),
      ...(actor ? { actor } : {}),
    }),
  });
  return handleJson(res);
}

export async function materialisePackageFromPo(poNumber) {
  const actor = sessionActor();
  const res = await fetch(
    buildUrl(`/api/packages/materialise-from-po/${encodeURIComponent(poNumber)}`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actor ? { actor } : {}),
    }
  );
  return handleJson(res);
}
