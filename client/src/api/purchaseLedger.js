/**
 * BL-031B — Purchase ledger server API client (BL-031A routes).
 *
 * Live import/reverse are used when VITE_LEDGER_SERVER_AUTHORITY is ON (BL-031D).
 */

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(
  /\/+$/,
  ''
);

const buildUrl = (path) => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export class PurchaseLedgerApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Purchase ledger API request failed');
    this.name = 'PurchaseLedgerApiError';
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
    throw new PurchaseLedgerApiError(body?.message || res.statusText || 'Request failed', {
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
  return { ...payload, actor, importedBy: payload.importedBy ?? actor };
}

function ledgerUrl(developmentId, suffix) {
  return `/api/developments/${encodeURIComponent(developmentId)}/ledger/${suffix}`;
}

export async function listLedgerBatchesForDevelopment(developmentId) {
  const res = await fetch(buildUrl(ledgerUrl(developmentId, 'batches')));
  const data = await handleJson(res);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.batches)) return data.batches;
  return [];
}

export async function listLedgerTransactionsForDevelopment(developmentId) {
  const res = await fetch(buildUrl(ledgerUrl(developmentId, 'transactions')));
  const data = await handleJson(res);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.transactions)) return data.transactions;
  return [];
}

export async function getLedgerTotalsForDevelopment(developmentId) {
  const res = await fetch(buildUrl(ledgerUrl(developmentId, 'totals')));
  return handleJson(res);
}

export async function importLedgerBatchForDevelopment(developmentId, payload = {}) {
  const res = await fetch(buildUrl(ledgerUrl(developmentId, 'batches')), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withActor(payload)),
  });
  return handleJson(res);
}

export async function reverseLedgerTransactionForDevelopment(
  developmentId,
  transactionId,
  payload = {}
) {
  const res = await fetch(
    buildUrl(
      `${ledgerUrl(developmentId, 'transactions')}/${encodeURIComponent(transactionId)}/reverse`
    ),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withActor(payload)),
    }
  );
  return handleJson(res);
}
