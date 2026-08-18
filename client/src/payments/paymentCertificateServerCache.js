/**
 * BL-030B / BL-030C — In-memory V1 Payment Certificate cache (package-scoped).
 *
 * When VITE_CERTIFICATE_SERVER_AUTHORITY=true, reads use this cache.
 * Successful mutations patch the cache immediately; no localStorage fallback.
 */

import {
  listCertificatesForPackage,
  PaymentCertificateApiError,
} from '../api/paymentCertificates';
import { listCachedPackagesForDevelopment } from './packageStore';
import {
  normalizeServerPaymentCertificate,
  normalizeServerPaymentCertificateList,
} from './paymentCertificateServerMapper';

const PACKAGE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidPackageUuid(value) {
  return PACKAGE_UUID_PATTERN.test(String(value || '').trim());
}

export class PaymentCertificateCacheError extends Error {
  constructor(message, { code = 'ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'PaymentCertificateCacheError';
    this.code = code;
    this.status = status;
  }
}

const cacheByPackage = new Map();
const loadStateByPackage = new Map();
const loadErrorByPackage = new Map();
const loadPromiseByPackage = new Map();
const packageUuidByOrderKey = new Map();
const loadStateByDevelopment = new Map();
const loadErrorByDevelopment = new Map();
const loadPromiseByDevelopment = new Map();

function wrapApiError(error) {
  if (error instanceof PaymentCertificateCacheError) return error;
  if (error instanceof PaymentCertificateApiError) {
    return new PaymentCertificateCacheError(error.message, {
      code: 'API_ERROR',
      status: error.status,
    });
  }
  return new PaymentCertificateCacheError(
    error?.message || 'Payment Certificate server request failed',
    { code: 'NETWORK_ERROR' }
  );
}

function rememberOrderKey(packageUuid, certificates) {
  for (const certificate of certificates) {
    if (certificate.orderKey) {
      packageUuidByOrderKey.set(certificate.orderKey, packageUuid);
    }
  }
}

function indexCertificates(packageUuid, certificates) {
  cacheByPackage.set(packageUuid, certificates);
  rememberOrderKey(packageUuid, certificates);
}

export function getCertificateLoadState(packageUuid) {
  return loadStateByPackage.get(packageUuid) || 'idle';
}

export function getCertificateLoadError(packageUuid) {
  return loadErrorByPackage.get(packageUuid) || null;
}

export function getCachedCertificates(packageUuid) {
  return cacheByPackage.get(packageUuid) || [];
}

export function getCachedCertificate(packageUuid, certificateId) {
  if (!certificateId) return null;
  return (
    getCachedCertificates(packageUuid).find((item) => item.id === certificateId) || null
  );
}

export function getCachedPackageUuidForOrderKey(orderKey) {
  return packageUuidByOrderKey.get(orderKey) || null;
}

export function rememberPackageUuidForOrderKey(orderKey, packageUuid) {
  if (orderKey && packageUuid) {
    packageUuidByOrderKey.set(orderKey, packageUuid);
  }
}

export function getDevelopmentCertificateLoadState(developmentId) {
  return loadStateByDevelopment.get(developmentId) || 'idle';
}

export function getDevelopmentCertificateLoadError(developmentId) {
  return loadErrorByDevelopment.get(developmentId) || null;
}

export function getDevelopmentCertificateFinancialReadiness(developmentId) {
  const loadState = getDevelopmentCertificateLoadState(developmentId);
  if (loadState === 'loaded') {
    return { ready: true, loadState, error: null };
  }
  if (loadState === 'loading') {
    return { ready: false, loadState, error: null, reason: 'loading' };
  }
  if (loadState === 'error') {
    return {
      ready: false,
      loadState,
      error: getDevelopmentCertificateLoadError(developmentId),
      reason: 'error',
    };
  }
  return { ready: false, loadState, error: null, reason: 'idle' };
}

export function getCertificateFinancialReadiness(packageUuid) {
  const loadState = getCertificateLoadState(packageUuid);
  if (loadState === 'loaded') {
    return { ready: true, loadState, error: null };
  }
  if (loadState === 'loading') {
    return { ready: false, loadState, error: null, reason: 'loading' };
  }
  if (loadState === 'error') {
    return {
      ready: false,
      loadState,
      error: getCertificateLoadError(packageUuid),
      reason: 'error',
    };
  }
  return { ready: false, loadState, error: null, reason: 'idle' };
}

async function fetchAndIndex(packageUuid) {
  const documents = await listCertificatesForPackage(packageUuid);
  const certificates = normalizeServerPaymentCertificateList(documents);
  indexCertificates(packageUuid, certificates);
  return certificates;
}

export async function refreshCertificatesForPackage(packageUuid) {
  if (!packageUuid) return [];
  loadStateByPackage.set(packageUuid, 'loading');
  loadErrorByPackage.set(packageUuid, null);

  try {
    const certificates = await fetchAndIndex(packageUuid);
    loadStateByPackage.set(packageUuid, 'loaded');
    return certificates;
  } catch (error) {
    const wrapped = wrapApiError(error);
    loadStateByPackage.set(packageUuid, 'error');
    loadErrorByPackage.set(packageUuid, wrapped);
    throw wrapped;
  }
}

export function ensureCertificatesReadyForDevelopment(developmentId) {
  if (!developmentId) {
    return Promise.reject(
      new PaymentCertificateCacheError(
        'Unable to load payment certificates because this development has no identity.',
        { code: 'MISSING_DEVELOPMENT_ID' }
      )
    );
  }

  if (loadPromiseByDevelopment.has(developmentId)) {
    return loadPromiseByDevelopment.get(developmentId);
  }

  if (getDevelopmentCertificateLoadState(developmentId) === 'loaded') {
    return Promise.resolve(
      listCachedPackagesForDevelopment(developmentId)
        .map((pkg) => pkg.id)
        .filter(isValidPackageUuid)
    );
  }

  const promise = (async () => {
    loadStateByDevelopment.set(developmentId, 'loading');
    loadErrorByDevelopment.set(developmentId, null);

    const packages = listCachedPackagesForDevelopment(developmentId);
    const uuids = [
      ...new Set(packages.map((pkg) => pkg.id).filter((id) => isValidPackageUuid(id))),
    ];

    try {
      await Promise.all(
        uuids.map(async (packageUuid) => {
          const orderKey = packages.find((pkg) => pkg.id === packageUuid)?.orderKey;
          if (orderKey) {
            rememberPackageUuidForOrderKey(orderKey, packageUuid);
          }
          await ensureCertificatesReadyForPackage(packageUuid);
        })
      );
      loadStateByDevelopment.set(developmentId, 'loaded');
      loadErrorByDevelopment.set(developmentId, null);
      return uuids;
    } catch (error) {
      const wrapped = wrapApiError(error);
      loadStateByDevelopment.set(developmentId, 'error');
      loadErrorByDevelopment.set(developmentId, wrapped);
      throw wrapped;
    } finally {
      loadPromiseByDevelopment.delete(developmentId);
    }
  })();

  loadPromiseByDevelopment.set(developmentId, promise);
  return promise;
}

export async function ensureCertificatesReadyForPackage(packageUuid) {
  if (!packageUuid) {
    throw new PaymentCertificateCacheError(
      'Unable to load payment certificates because this package has no server identity.',
      { code: 'MISSING_PACKAGE_UUID' }
    );
  }

  if (loadPromiseByPackage.has(packageUuid)) {
    return loadPromiseByPackage.get(packageUuid);
  }

  if (getCertificateLoadState(packageUuid) === 'loaded') {
    return getCachedCertificates(packageUuid);
  }

  const promise = (async () => {
    loadStateByPackage.set(packageUuid, 'loading');
    loadErrorByPackage.set(packageUuid, null);

    try {
      const certificates = await fetchAndIndex(packageUuid);
      loadStateByPackage.set(packageUuid, 'loaded');
      return certificates;
    } catch (error) {
      const wrapped = wrapApiError(error);
      loadStateByPackage.set(packageUuid, 'error');
      loadErrorByPackage.set(packageUuid, wrapped);
      throw wrapped;
    } finally {
      loadPromiseByPackage.delete(packageUuid);
    }
  })();

  loadPromiseByPackage.set(packageUuid, promise);
  return promise;
}

export function replaceCachedCertificates(packageUuid, documents) {
  if (!packageUuid) return [];
  const certificates = normalizeServerPaymentCertificateList(documents);
  indexCertificates(packageUuid, certificates);
  loadStateByPackage.set(packageUuid, 'loaded');
  loadErrorByPackage.set(packageUuid, null);
  return certificates;
}

export function upsertCachedCertificate(packageUuid, document) {
  if (!packageUuid || !document) return null;
  const normalized = normalizeServerPaymentCertificate(document);
  if (!normalized) return null;

  const existing = getCachedCertificates(packageUuid);
  const index = existing.findIndex((item) => item.id === normalized.id);
  const next =
    index === -1
      ? [...existing, normalized].sort((a, b) => a.certificateNumber - b.certificateNumber)
      : existing.map((item) => (item.id === normalized.id ? normalized : item));

  indexCertificates(packageUuid, next);
  loadStateByPackage.set(packageUuid, 'loaded');
  loadErrorByPackage.set(packageUuid, null);
  return normalized;
}

export function removeCachedCertificate(packageUuid, certificateId) {
  if (!packageUuid || !certificateId) return;
  const next = getCachedCertificates(packageUuid).filter((item) => item.id !== certificateId);
  indexCertificates(packageUuid, next);
}

export function __resetPaymentCertificateServerCacheForTests() {
  cacheByPackage.clear();
  loadStateByPackage.clear();
  loadErrorByPackage.clear();
  loadPromiseByPackage.clear();
  packageUuidByOrderKey.clear();
  loadStateByDevelopment.clear();
  loadErrorByDevelopment.clear();
  loadPromiseByDevelopment.clear();
}
