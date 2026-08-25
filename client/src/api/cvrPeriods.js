/**
 * BL-031B — CVR period server API client (BL-031A routes).
 *
 * Live UI mutations are used when VITE_CVR_SERVER_AUTHORITY is ON (BL-031D).
 */

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(
  /\/+$/,
  ''
);

const buildUrl = (path) => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export class CvrPeriodApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'CVR period API request failed');
    this.name = 'CvrPeriodApiError';
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
    throw new CvrPeriodApiError(body?.message || res.statusText || 'Request failed', {
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

function withActor(payload = {}, { includeCreatedBy = false } = {}) {
  const actor = sessionActor();
  if (!actor) return payload;
  const next = { ...payload, actor };
  if (includeCreatedBy) {
    next.createdBy = payload.createdBy ?? actor;
  }
  return next;
}

function periodsUrl(developmentId, periodId = '') {
  const base = `/api/developments/${encodeURIComponent(developmentId)}/cvr/periods`;
  return periodId ? `${base}/${encodeURIComponent(periodId)}` : base;
}

function inputsUrl(developmentId, periodId, inputId = '') {
  const base = `${periodsUrl(developmentId, periodId)}/inputs`;
  return inputId ? `${base}/${encodeURIComponent(inputId)}` : base;
}

export async function listCvrPeriodsForDevelopment(developmentId) {
  const res = await fetch(buildUrl(periodsUrl(developmentId)));
  const data = await handleJson(res);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.periods)) return data.periods;
  return [];
}

export async function getCvrPeriodById(developmentId, periodId) {
  const res = await fetch(buildUrl(periodsUrl(developmentId, periodId)));
  return handleJson(res);
}

export async function createCvrPeriodForDevelopment(developmentId, payload = {}) {
  const res = await fetch(buildUrl(periodsUrl(developmentId)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload, { includeCreatedBy: true })),
  });
  return handleJson(res);
}

export async function patchCvrPeriodForDevelopment(developmentId, periodId, payload = {}) {
  const res = await fetch(buildUrl(periodsUrl(developmentId, periodId)), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function submitCvrPeriodForDevelopment(developmentId, periodId, payload = {}) {
  const res = await fetch(buildUrl(`${periodsUrl(developmentId, periodId)}/submit`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function rejectCvrPeriodForDevelopment(developmentId, periodId, payload = {}) {
  const res = await fetch(buildUrl(`${periodsUrl(developmentId, periodId)}/reject`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function approveCvrPeriodForDevelopment(developmentId, periodId, payload = {}) {
  const res = await fetch(buildUrl(`${periodsUrl(developmentId, periodId)}/approve`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function listCvrPeriodInputs(developmentId, periodId) {
  const res = await fetch(buildUrl(inputsUrl(developmentId, periodId)));
  const data = await handleJson(res);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.inputs)) return data.inputs;
  return [];
}

export async function createCvrPeriodInput(developmentId, periodId, payload = {}) {
  const res = await fetch(buildUrl(inputsUrl(developmentId, periodId)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload, { includeCreatedBy: true })),
  });
  return handleJson(res);
}

export async function upsertCvrPeriodInputs(developmentId, periodId, payload = {}) {
  const res = await fetch(buildUrl(inputsUrl(developmentId, periodId)), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function patchCvrPeriodInput(developmentId, periodId, inputId, payload = {}) {
  const res = await fetch(buildUrl(inputsUrl(developmentId, periodId, inputId)), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function addCvrCostCodeMember(developmentId, periodId, payload = {}) {
  const res = await fetch(
    buildUrl(`${periodsUrl(developmentId, periodId)}/cost-code-members`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withActor(payload)),
    }
  );
  return handleJson(res);
}

export async function importCvrBudget(developmentId, periodId, payload = {}) {
  const res = await fetch(
    buildUrl(`${periodsUrl(developmentId, periodId)}/budget-import`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withActor(payload)),
    }
  );
  return handleJson(res);
}
