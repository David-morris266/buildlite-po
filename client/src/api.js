// client/src/api.js

// Decide API base URL
// - Local dev → http://localhost:3001
// - Netlify → Render backend (via env or fallback)
const RAW_ENV_BASE = import.meta.env.VITE_API_BASE_URL;

const API_BASE = (
  (RAW_ENV_BASE && RAW_ENV_BASE.trim()) ||
  (window.location.hostname === "localhost"
    ? "http://localhost:3001"
    : "https://buildlite-po-api.onrender.com")
).replace(/\/+$/, ""); // remove trailing slash

// Build full URL
const buildUrl = (path) =>
  `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

// Handle JSON + error messages
async function handleJson(res) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText || "Request failed");
  }
  return res.json();
}

/* ============================================================
   SUPPLIERS  (correct backend routes: /api/po/suppliers)
   ============================================================ */
export async function listSuppliers(q = "") {
  const url = q
    ? buildUrl(`/api/po/suppliers?q=${encodeURIComponent(q)}`)
    : buildUrl("/api/po/suppliers");

  const res = await fetch(url);
  return handleJson(res);
}

export async function createSupplier(body) {
  const url = buildUrl("/api/po/suppliers");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

  return handleJson(res);
}

/* ============================================================
   JOBS (correct backend routes: /api/jobs)
   ============================================================ */
export async function listJobs(q = "") {
  const url = q
    ? buildUrl(`/api/jobs?q=${encodeURIComponent(q)}`)
    : buildUrl("/api/jobs");

  const res = await fetch(url);
  return handleJson(res);
}

export async function getJob(id) {
  const url = buildUrl(`/api/jobs/${encodeURIComponent(id)}`);
  const res = await fetch(url);
  return handleJson(res);
}

/* ============================================================
   COST CODES  (correct backend route: /api/po/cost-codes)
   ============================================================ */
export async function listCostCodes(params = "") {
  const query =
    typeof params === "string"
      ? params
      : new URLSearchParams(params || {}).toString();

  const url = buildUrl(
    `/api/po/cost-codes${query ? `?${query}` : ""}`
  );

  const res = await fetch(url);
  return handleJson(res);
}

/* ============================================================
   PO LIST + CRUD ENDPOINTS (correct: /api/po/*)
   ============================================================ */
export async function listPOs(params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = buildUrl(`/api/po${query ? `?${query}` : ""}`);

  const res = await fetch(url);
  return handleJson(res);
}

export async function getPO(number) {
  const url = buildUrl(`/api/po/${encodeURIComponent(number)}`);
  const res = await fetch(url);
  return handleJson(res);
}

export async function deletePO(number) {
  const url = buildUrl(`/api/po/${encodeURIComponent(number)}`);
  const res = await fetch(url, { method: "DELETE" });
  return handleJson(res);
}

export async function approvePO(number, body) {
  const url = buildUrl(`/api/po/${encodeURIComponent(number)}/approve`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

  return handleJson(res);
}

export async function requestApproval(number, body) {
  const url = buildUrl(
    `/api/po/${encodeURIComponent(number)}/request-approval`
  );

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

  return handleJson(res);
}
