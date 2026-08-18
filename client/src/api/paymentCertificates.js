/**
 * BL-030B / BL-030C — V1 Payment Certificate server API client.
 */

const API_BASE = (
  import.meta.env.VITE_API_URL || 'http://localhost:3001'
).replace(/\/+$/, '');

const buildUrl = (path) =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export class PaymentCertificateApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Payment Certificate API request failed');
    this.name = 'PaymentCertificateApiError';
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
    throw new PaymentCertificateApiError(
      body?.message || res.statusText || 'Request failed',
      {
        status: res.status,
        body,
      }
    );
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

function withActor(payload = {}, { includeCreatedBy = false } = {}) {
  const actor = sessionActor();
  if (!actor) return payload;
  const next = {
    ...payload,
    actor,
  };
  if (includeCreatedBy) {
    next.createdBy = payload.createdBy ?? actor;
  }
  return next;
}

function certificatesUrl(packageId, certificateId = '') {
  const base = `/api/packages/${encodeURIComponent(packageId)}/certificates`;
  return certificateId ? `${base}/${encodeURIComponent(certificateId)}` : base;
}

export async function listCertificatesForPackage(packageId) {
  const res = await fetch(buildUrl(certificatesUrl(packageId)));
  const data = await handleJson(res);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.certificates)) return data.certificates;
  return [];
}

export async function getCertificateById(packageId, certificateId) {
  const res = await fetch(buildUrl(certificatesUrl(packageId, certificateId)));
  return handleJson(res);
}

export async function createCertificateForPackage(packageId, payload = {}) {
  const res = await fetch(buildUrl(certificatesUrl(packageId)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload, { includeCreatedBy: true })),
  });
  return handleJson(res);
}

export async function patchCertificateForPackage(packageId, certificateId, payload = {}) {
  const res = await fetch(buildUrl(certificatesUrl(packageId, certificateId)), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function submitCertificateForPackage(packageId, certificateId, payload = {}) {
  const res = await fetch(
    buildUrl(`${certificatesUrl(packageId, certificateId)}/submit`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withActor(payload)),
    }
  );
  return handleJson(res);
}

export async function approveCertificateForPackage(packageId, certificateId, payload = {}) {
  const res = await fetch(
    buildUrl(`${certificatesUrl(packageId, certificateId)}/approve`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withActor(payload)),
    }
  );
  return handleJson(res);
}

export async function rejectCertificateForPackage(packageId, certificateId, payload = {}) {
  const res = await fetch(
    buildUrl(`${certificatesUrl(packageId, certificateId)}/reject`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withActor(payload)),
    }
  );
  return handleJson(res);
}

export async function deleteCertificateForPackage(packageId, certificateId, payload = {}) {
  const res = await fetch(buildUrl(certificatesUrl(packageId, certificateId)), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  if (res.status === 204) return null;
  return handleJson(res);
}
