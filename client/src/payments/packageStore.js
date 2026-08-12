/**
 * BL-027B.2 — Server-backed Package identity store (Postgres authority).
 *
 * buildlite_subcontract_packages_v1 remains for certificates/activity only.
 */

import {
  getPackageById as apiGetPackageById,
  getPackageByOrderKey as apiGetPackageByOrderKey,
  listPackagesForDevelopment as apiListPackagesForDevelopment,
  materialisePackages as apiMaterialisePackages,
  PackageApiError,
} from '../api/packages';
import {
  buildPoOrdersForDevelopment,
  findMissingServerPackageKeys,
} from './packageIdentityMerge';

export class PackageStoreError extends Error {
  constructor(message, { code = 'ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'PackageStoreError';
    this.code = code;
    this.status = status;
  }
}

const cacheByDevelopment = new Map();
const loadStateByDevelopment = new Map();
const loadErrorByDevelopment = new Map();
const loadPromiseByDevelopment = new Map();

function wrapApiError(error) {
  if (error instanceof PackageStoreError) return error;
  if (error instanceof PackageApiError) {
    return new PackageStoreError(error.message, {
      code: 'API_ERROR',
      status: error.status,
    });
  }
  return new PackageStoreError(error?.message || 'Package server request failed', {
    code: 'NETWORK_ERROR',
  });
}

function indexPackages(developmentId, packages) {
  cacheByDevelopment.set(developmentId, packages);
}

export function getPackagesLoadState(developmentId) {
  return {
    loadState: loadStateByDevelopment.get(developmentId) || 'idle',
    loadError: loadErrorByDevelopment.get(developmentId) || null,
  };
}

export function listCachedPackagesForDevelopment(developmentId) {
  return cacheByDevelopment.get(developmentId) || [];
}

export function getCachedPackageByOrderKey(developmentId, orderKey) {
  return (
    listCachedPackagesForDevelopment(developmentId).find(
      (pkg) => pkg.orderKey === orderKey
    ) || null
  );
}

export function getCachedPackageById(developmentId, packageId) {
  return (
    listCachedPackagesForDevelopment(developmentId).find((pkg) => pkg.id === packageId) ||
    null
  );
}

export async function loadPackagesForDevelopment(developmentId) {
  const packages = await apiListPackagesForDevelopment(developmentId);
  indexPackages(developmentId, packages);
  return packages;
}

export async function ensurePackagesReadyForDevelopment(developmentId, { pos = [] } = {}) {
  if (!developmentId) {
    return [];
  }

  if (loadPromiseByDevelopment.has(developmentId)) {
    return loadPromiseByDevelopment.get(developmentId);
  }

  const promise = (async () => {
    loadStateByDevelopment.set(developmentId, 'loading');
    loadErrorByDevelopment.set(developmentId, null);

    try {
      let packages = await apiListPackagesForDevelopment(developmentId);
      const poOrders = buildPoOrdersForDevelopment(developmentId, pos);
      const missingKeys = findMissingServerPackageKeys(packages, poOrders);

      if (missingKeys.length > 0) {
        await apiMaterialisePackages({ developmentId });
        packages = await apiListPackagesForDevelopment(developmentId);
      }

      indexPackages(developmentId, packages);
      loadStateByDevelopment.set(developmentId, 'loaded');
      return packages;
    } catch (error) {
      loadStateByDevelopment.set(developmentId, 'error');
      loadErrorByDevelopment.set(developmentId, wrapApiError(error));
      throw wrapApiError(error);
    } finally {
      loadPromiseByDevelopment.delete(developmentId);
    }
  })();

  loadPromiseByDevelopment.set(developmentId, promise);
  return promise;
}

export async function fetchPackageById(packageId) {
  return apiGetPackageById(packageId);
}

export async function fetchPackageByOrderKey(orderKey) {
  return apiGetPackageByOrderKey(orderKey);
}

export function __resetPackageStoreForTests() {
  cacheByDevelopment.clear();
  loadStateByDevelopment.clear();
  loadErrorByDevelopment.clear();
  loadPromiseByDevelopment.clear();
}
