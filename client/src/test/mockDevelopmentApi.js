/**
 * In-memory Development API mock for client tests (BL-027A.2).
 */

const developmentApiStore = {
  records: new Map(),
};

function sortRecords(records) {
  return [...records].sort(
    (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  );
}

function baseRecord(payload = {}, existing = null) {
  const now = new Date().toISOString();
  const id =
    payload.id ||
    existing?.id ||
    `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    clientId: payload.clientId ?? existing?.clientId ?? 'default-client',
    jobNumber: String(payload.jobNumber ?? existing?.jobNumber ?? '').trim(),
    developmentName: String(
      payload.developmentName ?? existing?.developmentName ?? ''
    ).trim(),
    status: payload.status ?? existing?.status ?? 'planning',
    startDate: payload.startDate ?? existing?.startDate ?? '',
    targetCompletion: payload.targetCompletion ?? existing?.targetCompletion ?? '',
    client: payload.client ?? existing?.client ?? '',
    plotCount: payload.plotCount ?? existing?.plotCount ?? 0,
    plotMaster: payload.plotMaster ??
      existing?.plotMaster ?? {
        plots: [],
        updatedAt: now,
      },
    version: existing?.version ?? 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    createdBy: payload.createdBy ?? existing?.createdBy ?? null,
    updatedBy: payload.updatedBy ?? existing?.updatedBy ?? null,
  };
}

export function resetDevelopmentApiStore() {
  developmentApiStore.records.clear();
}

export class DevelopmentApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Development API request failed');
    this.name = 'DevelopmentApiError';
    this.status = status;
    this.body = body;
  }
}

export async function listDevelopments() {
  return sortRecords(developmentApiStore.records.values());
}

export async function getDevelopment(id) {
  const record = developmentApiStore.records.get(id);
  if (!record) {
    throw new DevelopmentApiError('Development not found.', {
      status: 404,
      body: { message: 'Development not found.' },
    });
  }
  return { ...record };
}

export async function createDevelopment(payload = {}) {
  const id = payload.id || `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (developmentApiStore.records.has(id)) {
    throw new DevelopmentApiError('Development already exists.', {
      status: 409,
      body: {
        message: 'Development already exists.',
        development: developmentApiStore.records.get(id),
      },
    });
  }

  const duplicateJob = [...developmentApiStore.records.values()].find(
    (item) => item.jobNumber && item.jobNumber === String(payload.jobNumber || '').trim()
  );
  if (duplicateJob) {
    throw new DevelopmentApiError('Duplicate job number.', {
      status: 409,
      body: { message: 'Duplicate job number.' },
    });
  }

  const record = baseRecord({ ...payload, id });
  developmentApiStore.records.set(id, record);
  return { ...record };
}

export async function updateDevelopment(id, payload = {}) {
  const existing = developmentApiStore.records.get(id);
  if (!existing) {
    throw new DevelopmentApiError('Development not found.', {
      status: 404,
      body: { message: 'Development not found.' },
    });
  }

  const expectedVersion = payload.version ?? existing.version;
  if (expectedVersion !== existing.version) {
    throw new DevelopmentApiError('Version conflict.', {
      status: 409,
      body: { message: 'Version conflict.', development: { ...existing } },
    });
  }

  const next = baseRecord({ ...existing, ...payload, id }, existing);
  next.version = existing.version + 1;
  developmentApiStore.records.set(id, next);
  return { ...next };
}
