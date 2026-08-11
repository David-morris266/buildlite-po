import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('../api/developments', () => import('../test/mockDevelopmentApi'));

import {
  createDevelopment as apiCreateDevelopment,
  DevelopmentApiError,
  listDevelopments as apiListDevelopments,
} from '../api/developments';
import {
  clearImportAttemptedFlagForTests,
  DEVELOPMENTS_LOCAL_BACKUP_KEY,
  readLocalDevelopmentsBackup,
} from '../developments/developmentLocalBackup';
import {
  __resetDevelopmentsStoreForTests,
  createDevelopment,
  ensureDevelopmentsReady,
  getDevelopment,
  importLocalDevelopments,
  listDevelopments,
  updateDevelopment,
  VERSION_CONFLICT_MESSAGE,
  DevelopmentStoreError,
} from '../developments/developmentStore';
import { resetDevelopmentApiStore } from '../test/mockDevelopmentApi';
import { buildSubcontractOrderKey } from '../payments/packageKeyMigration';

const TEST_SITE_ID = 'dev-1785599776666-zck5pl';

function sampleLocalDevelopment(id = TEST_SITE_ID) {
  return {
    id,
    jobNumber: 'TS1-001',
    developmentName: 'Test Site 1',
    status: 'live',
    startDate: '2025-01-01',
    targetCompletion: '2026-12-31',
    plotCount: 2,
    plotMaster: {
      plots: [
        {
          id: 'plot-ts1-1',
          plotNumber: '1',
          houseType: 'Ash',
          niaFt2: 950,
          status: 'Active',
        },
        {
          id: 'plot-ts1-2',
          plotNumber: '2',
          houseType: 'Oak',
          niaFt2: 1100,
          status: 'Active',
        },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

describe('developmentStore BL-027A.2', () => {
  beforeEach(() => {
    storage.clear();
    resetDevelopmentApiStore();
    __resetDevelopmentsStoreForTests();
    clearImportAttemptedFlagForTests();
  });

  it('loads developments from the server API', async () => {
    await apiCreateDevelopment({
      id: 'dev-list-1',
      jobNumber: 'DEV-001',
      developmentName: 'Alpha',
    });

    const items = await ensureDevelopmentsReady({ attemptImport: false });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('dev-list-1');
    expect(listDevelopments()).toHaveLength(1);
  });

  it('creates developments via POST and caches the server record', async () => {
    const created = await createDevelopment({
      jobNumber: 'DEV-010',
      developmentName: 'Created Dev',
    });

    expect(created.id).toMatch(/^dev-/);
    expect(getDevelopment(created.id)?.developmentName).toBe('Created Dev');
    expect(storage.has(DEVELOPMENTS_LOCAL_BACKUP_KEY)).toBe(false);
  });

  it('preserves supplied dev-* id on controlled import', async () => {
    storage.set(
      DEVELOPMENTS_LOCAL_BACKUP_KEY,
      JSON.stringify([sampleLocalDevelopment()])
    );

    const result = await importLocalDevelopments();
    expect(result.imported).toBe(1);
    expect(getDevelopment(TEST_SITE_ID)?.developmentName).toBe('Test Site 1');
    expect(getDevelopment(TEST_SITE_ID)?.plotMaster?.plots).toHaveLength(2);
  });

  it('does not overwrite existing server records during import', async () => {
    await apiCreateDevelopment({
      id: TEST_SITE_ID,
      jobNumber: 'TS1-001',
      developmentName: 'Server Copy',
    });

    storage.set(
      DEVELOPMENTS_LOCAL_BACKUP_KEY,
      JSON.stringify([sampleLocalDevelopment()])
    );

    const result = await importLocalDevelopments({ force: true });
    expect(result.skipped).toBeGreaterThan(0);
    expect(getDevelopment(TEST_SITE_ID)?.developmentName).toBe('Server Copy');
  });

  it('updates with current version and increments client cache version', async () => {
    const created = await createDevelopment({
      jobNumber: 'DEV-020',
      developmentName: 'Version Dev',
    });

    const updated = await updateDevelopment(created.id, {
      developmentName: 'Version Dev Updated',
      version: created.version,
    });

    expect(updated.version).toBe(created.version + 1);
    expect(getDevelopment(created.id)?.developmentName).toBe('Version Dev Updated');
  });

  it('surfaces 409 version conflicts without overwriting server state', async () => {
    const created = await createDevelopment({
      jobNumber: 'DEV-030',
      developmentName: 'Conflict Dev',
    });

    await expect(
      updateDevelopment(created.id, {
        developmentName: 'Stale Write',
        version: created.version - 1,
      })
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      message: VERSION_CONFLICT_MESSAGE,
    });

    expect(getDevelopment(created.id)?.developmentName).toBe('Conflict Dev');
  });

  it('does not silently read localStorage when the server list fails', async () => {
    storage.set(
      DEVELOPMENTS_LOCAL_BACKUP_KEY,
      JSON.stringify([sampleLocalDevelopment()])
    );

    vi.spyOn(await import('../api/developments'), 'listDevelopments').mockRejectedValueOnce(
      new DevelopmentApiError('Server unavailable', { status: 503 })
    );

    const { loadDevelopments } = await import('../developments/developmentStore');
    await expect(loadDevelopments()).rejects.toBeInstanceOf(DevelopmentStoreError);
    expect(listDevelopments()).toHaveLength(0);
  });

  it('leaves localStorage rollback copy untouched after import', async () => {
    const backup = [sampleLocalDevelopment()];
    storage.set(DEVELOPMENTS_LOCAL_BACKUP_KEY, JSON.stringify(backup));

    await importLocalDevelopments();
    expect(JSON.parse(storage.get(DEVELOPMENTS_LOCAL_BACKUP_KEY))).toEqual(backup);
  });

  it('keeps package orderKey unchanged for the same developmentId', () => {
    const orderKey = buildSubcontractOrderKey(TEST_SITE_ID, 'sup-abc', '5218');
    expect(orderKey).toBe(`${TEST_SITE_ID}::sup-abc::5218`);
  });
});

describe('developmentStore import guards', () => {
  beforeEach(() => {
    storage.clear();
    resetDevelopmentApiStore();
    __resetDevelopmentsStoreForTests();
    clearImportAttemptedFlagForTests();
  });

  it('imports only when server is empty, local data exists, and import not yet attempted', async () => {
    storage.set(
      DEVELOPMENTS_LOCAL_BACKUP_KEY,
      JSON.stringify([sampleLocalDevelopment()])
    );

    await ensureDevelopmentsReady();
    expect(getDevelopment(TEST_SITE_ID)?.developmentName).toBe('Test Site 1');
    expect(readLocalDevelopmentsBackup()).toHaveLength(1);
  });

  it('does not import when server already has developments', async () => {
    await apiCreateDevelopment({
      id: 'dev-existing',
      jobNumber: 'DEV-999',
      developmentName: 'Existing',
    });
    storage.set(
      DEVELOPMENTS_LOCAL_BACKUP_KEY,
      JSON.stringify([sampleLocalDevelopment()])
    );

    const result = await importLocalDevelopments();
    expect(result.reason).toBe('server-not-empty');
    expect(getDevelopment(TEST_SITE_ID)).toBeNull();
  });
});

describe('developmentStore API error mapping', () => {
  beforeEach(() => {
    storage.clear();
    resetDevelopmentApiStore();
    __resetDevelopmentsStoreForTests();
  });

  it('wraps DevelopmentApiError as DevelopmentStoreError', async () => {
    await expect(apiListDevelopments()).resolves.toEqual([]);
    await apiCreateDevelopment({ id: 'dev-dup', jobNumber: 'A', developmentName: 'A' });

    await expect(
      createDevelopment({ id: 'dev-dup', jobNumber: 'B', developmentName: 'B' })
    ).rejects.toBeInstanceOf(DevelopmentStoreError);
  });

  it('maps missing development updates to NOT_FOUND', async () => {
    await expect(
      updateDevelopment('dev-missing', { developmentName: 'X', version: 1 })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
