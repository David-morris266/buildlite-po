/**
 * BL-033D.x.2A.1 — Server Cost Code Master mutations.
 * Live Admin does not call these in this slice. Tests prove no dual-write when ON.
 */

import {
  CostCodeApiError,
  createServerCostCode,
  setServerCostCodeActive,
  updateServerCostCode,
} from '../api/costCodes';
import { isCostCodeServerAuthorityEnabled } from './costCodeAuthority';
import { CostCodeCacheError, replaceCachedCostCode, requireCachedCostCodes } from './costCodeServerCache';

function wrap(error, fallbackMessage) {
  if (error instanceof CostCodeCacheError) return error;
  if (error instanceof CostCodeApiError) {
    const wrapped = new CostCodeCacheError(error.message, {
      code: error.status === 409 ? 'VERSION_CONFLICT' : 'API_ERROR',
      status: error.status,
    });
    wrapped.body = error.body;
    return wrapped;
  }
  return new CostCodeCacheError(error?.message || fallbackMessage, { code: 'NETWORK_ERROR' });
}

function assertAuthorityOn() {
  if (!isCostCodeServerAuthorityEnabled()) {
    throw new CostCodeCacheError('Cost code server authority is off.', { code: 'AUTHORITY_OFF' });
  }
}

export async function createCostCodeOnServer(payload = {}) {
  assertAuthorityOn();
  try {
    const document = await createServerCostCode(payload);
    replaceCachedCostCode(document);
    return { ok: true, costCode: document };
  } catch (error) {
    const wrapped = wrap(error, 'Failed to create cost code.');
    return {
      ok: false,
      status: wrapped.status || 0,
      errors: [wrapped.message],
      costCode: error?.body?.costCode || null,
    };
  }
}

export async function updateCostCodeOnServer(id, payload = {}) {
  assertAuthorityOn();
  requireCachedCostCodes();
  try {
    const document = await updateServerCostCode(id, payload);
    replaceCachedCostCode(document);
    return { ok: true, costCode: document };
  } catch (error) {
    const wrapped = wrap(error, 'Failed to save cost code.');
    return {
      ok: false,
      status: wrapped.status || 0,
      errors: [wrapped.message],
      costCode: error?.body?.costCode || null,
    };
  }
}

export async function setCostCodeActiveOnServer(id, payload = {}) {
  assertAuthorityOn();
  requireCachedCostCodes();
  try {
    const document = await setServerCostCodeActive(id, payload);
    replaceCachedCostCode(document);
    return { ok: true, costCode: document };
  } catch (error) {
    const wrapped = wrap(error, 'Failed to update cost code active state.');
    return {
      ok: false,
      status: wrapped.status || 0,
      errors: [wrapped.message],
      costCode: error?.body?.costCode || null,
    };
  }
}
