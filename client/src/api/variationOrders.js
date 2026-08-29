const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
const url = (path) => `${API_BASE}${path}`;

export class VariationOrderApiError extends Error {
  constructor(message, status = 0, body = null) {
    super(message || 'Variation Order request failed');
    this.name = 'VariationOrderApiError';
    this.status = status;
    this.body = body;
  }
}

function actor() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('userName') || localStorage.getItem('userEmail') || null;
}

async function request(path, options = {}) {
  const res = await fetch(url(path), options);
  const text = await res.text().catch(() => '');
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!res.ok) throw new VariationOrderApiError(body?.message || res.statusText, res.status, body);
  return body;
}

function json(method, payload = {}) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ...(actor() ? { actor: actor() } : {}) }),
  };
}

export function listVariationOrders(packageId) {
  const query = packageId ? `?packageId=${encodeURIComponent(packageId)}` : '';
  return request(`/api/variation-orders${query}`);
}

export function getVariationOrder(id) {
  return request(`/api/variation-orders/${encodeURIComponent(id)}`);
}

export function listCertificateReadyVariationOrderLines(packageId) {
  return request(`/api/variation-orders/certificate-readiness/${encodeURIComponent(packageId)}`);
}

export function createVariationOrderFromCommercialEvent(commercialEventId) {
  return request(`/api/variation-orders/from-commercial-event/${encodeURIComponent(commercialEventId)}`, json('POST'));
}

export function updateVariationOrder(id, payload) {
  return request(`/api/variation-orders/${encodeURIComponent(id)}`, json('PUT', payload));
}

export function submitVariationOrder(id, version) {
  return request(`/api/variation-orders/${encodeURIComponent(id)}/submit`, json('POST', { version }));
}

export function approveAndIssueVariationOrder(id, version, comment) {
  return request(`/api/variation-orders/${encodeURIComponent(id)}/approve-and-issue`, json('POST', { version, comment }));
}
