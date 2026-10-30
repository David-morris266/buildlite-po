/**
 * BL-009A.03A — Local development references for POs (fallback until payload is complete).
 */

const STORAGE_KEY = 'buildlite_po_development_refs_v1';

function activeTenantId() {
  try {
    return String(localStorage.getItem('buildlite_active_client_id') || '').trim();
  } catch {
    return '';
  }
}

function storageIdentity(poNumber, tenantId = activeTenantId()) {
  const number = String(poNumber || '').trim();
  const tenant = String(tenantId || '').trim();
  if (!number) return '';
  return tenant ? `${tenant}::${number}` : number;
}

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function savePoDevelopmentRef(poNumber, ref = {}, tenantId) {
  const number = String(poNumber || '').trim();
  if (!number || !ref.developmentId) return null;

  const all = readAll();
  const identity = storageIdentity(number, tenantId);
  all[identity] = {
    developmentId: ref.developmentId,
    developmentNumber: ref.developmentNumber || '',
    developmentName: ref.developmentName || '',
    updatedAt: new Date().toISOString(),
  };
  writeAll(all);
  return all[identity];
}

export function getPoDevelopmentRefByNumber(poNumber, tenantId) {
  const identity = storageIdentity(poNumber, tenantId);
  if (!identity) return null;
  return readAll()[identity] || null;
}

export function enrichPoWithDevelopmentRef(po) {
  if (!po) return po;

  const stored = getPoDevelopmentRefByNumber(po.poNumber);
  const developmentId =
    po.developmentId ||
    po.development?.id ||
    po.costRef?.developmentId ||
    stored?.developmentId ||
    '';

  if (!developmentId) return po;

  const developmentNumber =
    po.developmentNumber ||
    po.development?.developmentNumber ||
    stored?.developmentNumber ||
    '';
  const developmentName =
    po.developmentName ||
    po.development?.developmentName ||
    stored?.developmentName ||
    '';

  return {
    ...po,
    developmentId,
    developmentNumber,
    developmentName,
    development:
      po.development ||
      (developmentId
        ? {
            id: developmentId,
            developmentNumber,
            developmentName,
            status: po.developmentStatus || '',
            client: po.client || '',
          }
        : null),
    costRef: {
      ...(po.costRef || {}),
      developmentId: po.costRef?.developmentId || developmentId,
    },
  };
}

export function enrichPosWithDevelopmentRefs(pos) {
  return (Array.isArray(pos) ? pos : []).map(enrichPoWithDevelopmentRef);
}
