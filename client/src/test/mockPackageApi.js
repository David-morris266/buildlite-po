/**
 * In-memory Package API mock for client tests (BL-027B.2).
 */

const packageApiStore = {
  packages: new Map(),
  materialiseCalls: [],
};

function sortPackages(records) {
  return [...records].sort((a, b) =>
    String(a.supplierLabel || '').localeCompare(String(b.supplierLabel || ''), undefined, {
      sensitivity: 'base',
    })
  );
}

export function resetPackageApiStore() {
  packageApiStore.packages.clear();
  packageApiStore.materialiseCalls = [];
}

export class PackageApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Package API request failed');
    this.name = 'PackageApiError';
    this.status = status;
    this.body = body;
  }
}

export async function listPackagesForDevelopment(developmentId) {
  return sortPackages(
    [...packageApiStore.packages.values()].filter(
      (pkg) => pkg.developmentId === developmentId
    )
  );
}

export async function getPackageById(packageId) {
  const record = packageApiStore.packages.get(packageId);
  if (!record) {
    throw new PackageApiError('Package not found.', {
      status: 404,
      body: { message: 'Package not found.' },
    });
  }
  return { ...record };
}

export async function getPackageByOrderKey(orderKey) {
  const record = [...packageApiStore.packages.values()].find(
    (pkg) => pkg.orderKey === orderKey
  );
  if (!record) {
    throw new PackageApiError('Package not found.', {
      status: 404,
      body: { message: 'Package not found.' },
    });
  }
  return { ...record };
}

export async function materialisePackages({ developmentId } = {}) {
  packageApiStore.materialiseCalls.push({ developmentId: developmentId || null });
  return {
    ok: true,
    summary: {
      created: 0,
      updated: 0,
      packageCount: developmentId
        ? (await listPackagesForDevelopment(developmentId)).length
        : packageApiStore.packages.size,
      eligiblePoCount: 0,
      skippedCount: 0,
    },
    packages: developmentId
      ? await listPackagesForDevelopment(developmentId)
      : sortPackages(packageApiStore.packages.values()),
    skipped: [],
  };
}

export async function materialisePackageFromPo(poNumber) {
  const record = [...packageApiStore.packages.values()].find((pkg) =>
    (pkg.poNumbers || []).includes(poNumber)
  );
  if (!record) {
    throw new PackageApiError('PO not found.', {
      status: 404,
      body: { message: 'PO not found.' },
    });
  }
  return { created: false, package: { ...record } };
}

export function getMaterialiseCalls() {
  return [...packageApiStore.materialiseCalls];
}

export function seedMockPackage(record) {
  if (!record?.id || !record?.orderKey) {
    throw new Error('seedMockPackage requires id and orderKey');
  }
  packageApiStore.packages.set(record.id, { ...record });
  return record;
}
