/**
 * BL-029D — Server-authoritative Order Matrix mutations.
 *
 * PUT /api/packages/:packageId/matrix, patch in-memory cache, never write
 * buildlite_order_matrices_v1 while VITE_MATRIX_SERVER_AUTHORITY is ON.
 */

import { putMatrixForPackage, OrderMatrixApiError } from '../api/orderMatrices';
import { notifyCommercialChanged } from '../commercial/commercialEvents';
import { isOrderMatrixServerAuthorityEnabled } from './orderMatrixAuthority';
import {
  getCachedOrderMatrixByOrderKey,
  getCachedOrderMatrixByPackageUuid,
  patchCachedOrderMatrix,
  refreshMatricesForDevelopment,
} from './orderMatrixServerCache';
import {
  fetchPackageByOrderKey,
  getCachedPackageByOrderKey,
} from './packageStore';
import {
  resolveMatrixDevelopmentId,
  saveOrderMatrix,
} from './orderMatrixStore';

export const MATRIX_VERSION_CONFLICT_MESSAGE =
  'This order matrix was changed elsewhere. Refresh and retry.';

export const PACKAGE_UUID_REQUIRED_MESSAGE =
  'Unable to save the order matrix because this package has no server identity.';

const PACKAGE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidPackageUuid(value) {
  return PACKAGE_UUID_PATTERN.test(String(value || '').trim());
}

function mapApiError(error) {
  if (error instanceof OrderMatrixApiError) {
    if (error.status === 409) {
      return {
        ok: false,
        errors: [MATRIX_VERSION_CONFLICT_MESSAGE],
        status: 409,
        matrix: error.body?.matrix || null,
      };
    }
    const message =
      error.body?.message || error.message || 'Order matrix server request failed';
    return { ok: false, errors: [message], status: error.status };
  }
  return {
    ok: false,
    errors: [error?.message || 'Order matrix server request failed'],
  };
}

/**
 * Resolve the Postgres package UUID without substituting it for orderKey.
 * Does not materialise a package.
 */
export function resolvePackageUuidFromOrder(orderOrKey, developmentId = null) {
  const order = typeof orderOrKey === 'object' && orderOrKey ? orderOrKey : { orderKey: orderOrKey };
  const orderKey = order.orderKey || null;
  const resolvedDevelopmentId = resolveMatrixDevelopmentId(order, developmentId);

  const candidates = [order.packageUuid, order.packageId, order.id];
  for (const candidate of candidates) {
    if (isValidPackageUuid(candidate) && candidate !== orderKey) {
      return String(candidate).trim();
    }
  }

  if (resolvedDevelopmentId && orderKey) {
    const cachedMatrix = getCachedOrderMatrixByOrderKey(resolvedDevelopmentId, orderKey);
    if (isValidPackageUuid(cachedMatrix?.packageUuid)) {
      return cachedMatrix.packageUuid;
    }
  }

  if (resolvedDevelopmentId && orderKey) {
    const cachedPackage = getCachedPackageByOrderKey(resolvedDevelopmentId, orderKey);
    if (isValidPackageUuid(cachedPackage?.id)) {
      return cachedPackage.id;
    }
  }

  return null;
}

export async function resolvePackageUuidForMatrixSave(orderOrKey, developmentId = null) {
  const fromContext = resolvePackageUuidFromOrder(orderOrKey, developmentId);
  if (fromContext) return fromContext;

  const order = typeof orderOrKey === 'object' && orderOrKey ? orderOrKey : { orderKey: orderOrKey };
  const orderKey = order.orderKey || (typeof orderOrKey === 'string' ? orderOrKey : null);
  if (!orderKey) return null;

  try {
    const pkg = await fetchPackageByOrderKey(orderKey);
    if (isValidPackageUuid(pkg?.id)) return pkg.id;
  } catch {
    return null;
  }

  return null;
}

function buildPutPayload(order, matrixInput, existing) {
  const payload = {
    layout: 'plot-stage',
    committedValue: matrixInput.committedValue ?? order.committedValue ?? null,
    stages: Array.isArray(matrixInput.stages) ? matrixInput.stages : [],
    plots: Array.isArray(matrixInput.plots) ? matrixInput.plots : [],
    jobId: matrixInput.jobId ?? order.jobId ?? order.developmentId ?? '',
    supplierId: matrixInput.supplierId ?? order.supplierId ?? '',
    projectLabel: matrixInput.projectLabel ?? order.projectLabel ?? '',
    supplierLabel: matrixInput.supplierLabel ?? order.supplierLabel ?? '',
    orderKey: order.orderKey,
    developmentId: resolveMatrixDevelopmentId(order),
  };

  if (existing?.version != null) {
    payload.version = existing.version;
  }

  return payload;
}

async function persistOrderMatrixOnServer(order, matrixInput) {
  const developmentId = resolveMatrixDevelopmentId(order);
  const packageUuid = await resolvePackageUuidForMatrixSave(order, developmentId);
  if (!packageUuid) {
    return { ok: false, errors: [PACKAGE_UUID_REQUIRED_MESSAGE] };
  }

  const existing =
    (developmentId && getCachedOrderMatrixByOrderKey(developmentId, order.orderKey)) ||
    (developmentId && getCachedOrderMatrixByPackageUuid(developmentId, packageUuid)) ||
    null;

  try {
    const document = await putMatrixForPackage(
      packageUuid,
      buildPutPayload(order, matrixInput, existing)
    );
    const patchedDevelopmentId = developmentId || document.developmentId;
    if (!patchedDevelopmentId) {
      return { ok: false, errors: ['Server returned a matrix without a development id'] };
    }

    patchCachedOrderMatrix(patchedDevelopmentId, document);
    notifyCommercialChanged({
      developmentId: patchedDevelopmentId,
      orderKey: order.orderKey,
      packageUuid,
      source: 'order-matrix',
      action: existing ? 'updated' : 'created',
    });

    return {
      ok: true,
      matrix: getCachedOrderMatrixByOrderKey(patchedDevelopmentId, order.orderKey),
    };
  } catch (error) {
    const mapped = mapApiError(error);
    if (mapped.status === 409 && developmentId) {
      if (mapped.matrix) {
        patchCachedOrderMatrix(developmentId, mapped.matrix);
      } else {
        try {
          await refreshMatricesForDevelopment(developmentId);
        } catch {
          /* surface the 409 even if refresh fails */
        }
      }
    }
    return mapped;
  }
}

/**
 * Live import/save facade.
 * Authority OFF: synchronous localStorage write via saveOrderMatrix.
 * Authority ON: server PUT only; no localStorage matrix write.
 */
export async function persistOrderMatrix(order, matrixInput = {}) {
  if (!order?.orderKey) {
    return { ok: false, errors: ['Package order key is required'] };
  }

  if (!isOrderMatrixServerAuthorityEnabled()) {
    const saved = saveOrderMatrix(order.orderKey, {
      ...matrixInput,
      orderKey: order.orderKey,
    });
    return { ok: true, matrix: saved };
  }

  return persistOrderMatrixOnServer(order, matrixInput);
}
