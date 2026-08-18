/**
 * BL-030C — Server-authoritative Payment Certificate mutations.
 *
 * Single client entry for live certificate actions when
 * VITE_CERTIFICATE_SERVER_AUTHORITY is ON. Never writes certificate state
 * into buildlite_subcontract_packages_v1. Never falls back to localStorage.
 */

import {
  approveCertificateForPackage,
  createCertificateForPackage,
  deleteCertificateForPackage,
  patchCertificateForPackage,
  PaymentCertificateApiError,
  rejectCertificateForPackage,
  submitCertificateForPackage,
} from '../api/paymentCertificates';
import { notifyCommercialChanged } from '../commercial/commercialEvents';
import { resolveOrderMatrixForPackage } from './orderMatrixStore';
import { isValidPackageUuid, resolvePackageUuidFromOrder } from './orderMatrixServerMutations';
import { fetchPackageByOrderKey } from './packageStore';
import { applyPositionalProgressPatch } from './paymentCertificateProgressAdapter';
import {
  getCachedCertificate,
  getCachedPackageUuidForOrderKey,
  rememberPackageUuidForOrderKey,
  refreshCertificatesForPackage,
  removeCachedCertificate,
  upsertCachedCertificate,
} from './paymentCertificateServerCache';

export const CERTIFICATE_VERSION_CONFLICT_MESSAGE =
  'Payment certificate was changed elsewhere. Refresh and retry.';

export const PACKAGE_UUID_REQUIRED_MESSAGE =
  'Unable to save the payment certificate because this package has no server identity.';

export const MATRIX_REQUIRED_MESSAGE =
  'Unable to save certificate progress because the order matrix is not available.';

const mutationQueues = new Map();

function resolveDevelopmentId(orderKey, order = null) {
  return (
    order?.developmentId ||
    order?.scopeId ||
    order?.jobId ||
    (orderKey ? String(orderKey).split('::')[0] : null) ||
    null
  );
}

function notifyCertificateWorkflowChanged(orderKey, certificateId, action, order = null) {
  notifyCommercialChanged({
    source: 'certificate',
    orderKey,
    certificateId,
    action,
    developmentId: resolveDevelopmentId(orderKey, order),
  });
}

export async function resolvePackageUuidForCertificateMutation(orderOrKey, developmentId = null) {
  const order =
    typeof orderOrKey === 'object' && orderOrKey ? orderOrKey : { orderKey: orderOrKey };
  const orderKey = order.orderKey || (typeof orderOrKey === 'string' ? orderOrKey : null);

  const fromContext = resolvePackageUuidFromOrder(order, developmentId);
  if (fromContext) return fromContext;

  const remembered = getCachedPackageUuidForOrderKey(orderKey);
  if (isValidPackageUuid(remembered)) return remembered;

  if (!orderKey) return null;
  try {
    const pkg = await fetchPackageByOrderKey(orderKey);
    if (isValidPackageUuid(pkg?.id)) return pkg.id;
  } catch {
    return null;
  }
  return null;
}

function enqueueCertificateMutation(certificateId, work) {
  const key = certificateId || '__create__';
  const previous = mutationQueues.get(key) || Promise.resolve();
  const next = previous.then(work, work);
  mutationQueues.set(
    key,
    next.finally(() => {
      if (mutationQueues.get(key) === next) {
        mutationQueues.delete(key);
      }
    })
  );
  return next;
}

async function mapApiError(error, packageUuid) {
  if (error instanceof PaymentCertificateApiError) {
    if (error.status === 409) {
      const returned = error.body?.certificate || null;
      if (packageUuid && returned) {
        upsertCachedCertificate(packageUuid, returned);
      } else if (packageUuid) {
        try {
          await refreshCertificatesForPackage(packageUuid);
        } catch {
          /* surface the 409 even if refresh fails */
        }
      }
      return {
        ok: false,
        errors: [CERTIFICATE_VERSION_CONFLICT_MESSAGE],
        status: 409,
        certificate: returned
          ? getCachedCertificate(packageUuid, returned.id)
          : null,
      };
    }

    const message =
      error.body?.message || error.message || 'Payment certificate server request failed';
    return { ok: false, errors: [message], status: error.status };
  }

  return {
    ok: false,
    errors: [error?.message || 'Payment certificate server request failed'],
  };
}

function requireCachedCertificate(packageUuid, certificateId) {
  const certificate = getCachedCertificate(packageUuid, certificateId);
  if (!certificate) {
    return { ok: false, errors: ['Certificate not found.'] };
  }
  return { ok: true, certificate };
}

function requireExpectedVersion(certificate) {
  const version = Number(certificate?.version);
  if (!Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      errors: ['Payment certificate version is missing. Refresh and retry.'],
    };
  }
  return { ok: true, version };
}

function patchSuccess(packageUuid, document, orderKey, action, order) {
  const certificate = upsertCachedCertificate(packageUuid, document);
  if (orderKey) {
    rememberPackageUuidForOrderKey(orderKey, packageUuid);
  }
  notifyCertificateWorkflowChanged(orderKey, certificate?.id, action, order);
  return { ok: true, certificate };
}

export async function createCertificateOnServer(orderKey, order = {}) {
  const packageUuid = await resolvePackageUuidForCertificateMutation(order || { orderKey });
  if (!packageUuid) {
    return { ok: false, errors: [PACKAGE_UUID_REQUIRED_MESSAGE] };
  }

  try {
    const document = await createCertificateForPackage(packageUuid, {
      certificateDate: order.certificateDate || undefined,
    });
    rememberPackageUuidForOrderKey(orderKey, packageUuid);
    return patchSuccess(packageUuid, document, orderKey, 'created', order);
  } catch (error) {
    return mapApiError(error, packageUuid);
  }
}

async function patchDraftOnServer({
  orderKey,
  certificateId,
  order,
  buildPayload,
  action,
}) {
  const packageUuid = await resolvePackageUuidForCertificateMutation(order || { orderKey });
  if (!packageUuid) {
    return { ok: false, errors: [PACKAGE_UUID_REQUIRED_MESSAGE] };
  }

  return enqueueCertificateMutation(certificateId, async () => {
    const current = requireCachedCertificate(packageUuid, certificateId);
    if (!current.ok) return current;
    const versionCheck = requireExpectedVersion(current.certificate);
    if (!versionCheck.ok) return versionCheck;

    const built = buildPayload(current.certificate);
    if (!built.ok) return built;

    try {
      const document = await patchCertificateForPackage(packageUuid, certificateId, {
        version: versionCheck.version,
        ...built.payload,
      });
      return patchSuccess(packageUuid, document, orderKey, action, order);
    } catch (error) {
      return mapApiError(error, packageUuid);
    }
  });
}

export async function updateCertificateProgressOnServer(
  orderKey,
  certificateId,
  progressPatch,
  order = null,
  options = {}
) {
  return patchDraftOnServer({
    orderKey,
    certificateId,
    order,
    action: 'progress-updated',
    buildPayload: (certificate) => {
      const providedMatrix = options?.matrix || null;
      let matrix = providedMatrix;
      if (!matrix) {
        const matrixResolution = resolveOrderMatrixForPackage(
          order || { orderKey },
          order?.developmentId
        );
        if (!matrixResolution.ready || !matrixResolution.matrix) {
          return { ok: false, errors: [MATRIX_REQUIRED_MESSAGE] };
        }
        matrix = matrixResolution.matrix;
      }
      const converted = applyPositionalProgressPatch(
        certificate.progress,
        progressPatch,
        matrix
      );
      if (!converted.ok) {
        return converted;
      }
      return { ok: true, payload: { progress: converted.progress } };
    },
  });
}

export async function updateCertificateCommercialLinesOnServer(
  orderKey,
  certificateId,
  lineUpdater,
  order = null
) {
  return patchDraftOnServer({
    orderKey,
    certificateId,
    order,
    action: 'commercial-lines-updated',
    buildPayload: (certificate) => {
      try {
        const proposed = lineUpdater(certificate);
        if (proposed && proposed.ok === false) {
          return proposed;
        }
        return {
          ok: true,
          payload: {
            commercialLines: Array.isArray(proposed) ? proposed : [],
          },
        };
      } catch (error) {
        if (Array.isArray(error?.lineUpdateErrors)) {
          return { ok: false, errors: error.lineUpdateErrors };
        }
        throw error;
      }
    },
  });
}

export async function updateCertificateMetadataOnServer(
  orderKey,
  certificateId,
  patch,
  order = null
) {
  return patchDraftOnServer({
    orderKey,
    certificateId,
    order,
    action: 'metadata-updated',
    buildPayload: () => ({
      ok: true,
      payload: {
        ...(patch.certificateDate ? { certificateDate: patch.certificateDate } : {}),
      },
    }),
  });
}

export async function submitCertificateOnServer(orderKey, certificateId, order = null) {
  const packageUuid = await resolvePackageUuidForCertificateMutation(order || { orderKey });
  if (!packageUuid) {
    return { ok: false, errors: [PACKAGE_UUID_REQUIRED_MESSAGE] };
  }

  return enqueueCertificateMutation(certificateId, async () => {
    const current = requireCachedCertificate(packageUuid, certificateId);
    if (!current.ok) return current;
    const versionCheck = requireExpectedVersion(current.certificate);
    if (!versionCheck.ok) return versionCheck;

    try {
      const document = await submitCertificateForPackage(packageUuid, certificateId, {
        version: versionCheck.version,
      });
      return patchSuccess(packageUuid, document, orderKey, 'submitted', order);
    } catch (error) {
      return mapApiError(error, packageUuid);
    }
  });
}

export async function rejectCertificateOnServer(
  orderKey,
  certificateId,
  comment,
  order = null
) {
  const trimmed = String(comment || '').trim();
  if (!trimmed) {
    return { ok: false, errors: ['A rejection comment is required.'] };
  }

  const packageUuid = await resolvePackageUuidForCertificateMutation(order || { orderKey });
  if (!packageUuid) {
    return { ok: false, errors: [PACKAGE_UUID_REQUIRED_MESSAGE] };
  }

  return enqueueCertificateMutation(certificateId, async () => {
    const current = requireCachedCertificate(packageUuid, certificateId);
    if (!current.ok) return current;
    const versionCheck = requireExpectedVersion(current.certificate);
    if (!versionCheck.ok) return versionCheck;

    try {
      const document = await rejectCertificateForPackage(packageUuid, certificateId, {
        version: versionCheck.version,
        comment: trimmed,
      });
      return patchSuccess(packageUuid, document, orderKey, 'rejected', order);
    } catch (error) {
      return mapApiError(error, packageUuid);
    }
  });
}

export async function approveCertificateOnServer(orderKey, certificateId, order = null) {
  const packageUuid = await resolvePackageUuidForCertificateMutation(order || { orderKey });
  if (!packageUuid) {
    return { ok: false, errors: [PACKAGE_UUID_REQUIRED_MESSAGE] };
  }

  return enqueueCertificateMutation(certificateId, async () => {
    const current = requireCachedCertificate(packageUuid, certificateId);
    if (!current.ok) return current;
    const versionCheck = requireExpectedVersion(current.certificate);
    if (!versionCheck.ok) return versionCheck;

    try {
      const document = await approveCertificateForPackage(packageUuid, certificateId, {
        version: versionCheck.version,
      });
      return patchSuccess(packageUuid, document, orderKey, 'approved', order);
    } catch (error) {
      return mapApiError(error, packageUuid);
    }
  });
}

export async function deleteCertificateOnServer(orderKey, certificateId, order = null) {
  const packageUuid = await resolvePackageUuidForCertificateMutation(order || { orderKey });
  if (!packageUuid) {
    return { ok: false, errors: [PACKAGE_UUID_REQUIRED_MESSAGE] };
  }

  return enqueueCertificateMutation(certificateId, async () => {
    const current = requireCachedCertificate(packageUuid, certificateId);
    if (!current.ok) return current;
    if (current.certificate.status !== 'draft') {
      return { ok: false, errors: ['Only draft certificates can be deleted.'] };
    }

    const payload = {};
    const version = Number(current.certificate.version);
    if (Number.isInteger(version) && version >= 1) {
      payload.version = version;
    }

    try {
      await deleteCertificateForPackage(packageUuid, certificateId, payload);
      removeCachedCertificate(packageUuid, certificateId);
      notifyCertificateWorkflowChanged(orderKey, certificateId, 'deleted', order);
      return { ok: true };
    } catch (error) {
      return mapApiError(error, packageUuid);
    }
  });
}

export function __resetPaymentCertificateMutationQueuesForTests() {
  mutationQueues.clear();
}
