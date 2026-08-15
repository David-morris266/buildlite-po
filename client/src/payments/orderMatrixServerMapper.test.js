import { describe, expect, it } from 'vitest';
import {
  normalizeServerOrderMatrix,
  normalizeServerOrderMatrixList,
} from './orderMatrixServerMapper';

const ORDER_KEY = 'dev-001::sup-spark::0120';
const PACKAGE_UUID = 'pkg-uuid-spark-001';

describe('orderMatrixServerMapper', () => {
  it('normalises a server document to the client matrix shape without replacing orderKey', () => {
    const document = {
      id: 'mx-001',
      packageId: PACKAGE_UUID,
      orderKey: ORDER_KEY,
      developmentId: 'dev-001',
      layout: 'plot-stage',
      committedValue: '1500',
      stages: ['Foundations', 'Superstructure'],
      plots: [{ id: 'plot-1', label: 'Plot 1', values: [500, 1000] }],
      jobId: 'dev-001',
      supplierId: 'sup-spark',
      projectLabel: 'Test Site 1',
      supplierLabel: 'Sparktastic',
      version: 3,
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-15T12:00:00.000Z',
    };

    const matrix = normalizeServerOrderMatrix(document);

    expect(matrix.orderKey).toBe(ORDER_KEY);
    expect(matrix.orderKey).not.toBe(PACKAGE_UUID);
    expect(matrix.packageUuid).toBe(PACKAGE_UUID);
    expect(matrix.matrixId).toBe('mx-001');
    expect(matrix.version).toBe(3);
    expect(matrix.jobId).toBe('dev-001');
    expect(matrix.developmentId).toBe('dev-001');
    expect(matrix.supplierId).toBe('sup-spark');
    expect(matrix.committedValue).toBe(1500);
    expect(matrix.layout).toBe('plot-stage');
    expect(matrix.stages).toEqual(['Foundations', 'Superstructure']);
    expect(matrix.plots).toHaveLength(1);
    expect(matrix.updatedAt).toBe('2026-08-15T12:00:00.000Z');
  });

  it('accepts snake_case identity fields and keeps orderKey as the client key', () => {
    const matrix = normalizeServerOrderMatrix({
      id: 'mx-002',
      package_id: PACKAGE_UUID,
      order_key: ORDER_KEY,
      development_id: 'dev-001',
      committed_value: 2000,
      layout: '',
      stages: null,
      plots: null,
    });

    expect(matrix.orderKey).toBe(ORDER_KEY);
    expect(matrix.packageUuid).toBe(PACKAGE_UUID);
    expect(matrix.developmentId).toBe('dev-001');
    expect(matrix.jobId).toBe('dev-001');
    expect(matrix.committedValue).toBe(2000);
    expect(matrix.layout).toBe('plot-stage');
    expect(matrix.stages).toEqual([]);
    expect(matrix.plots).toEqual([]);
  });

  it('drops invalid entries from a list', () => {
    const matrices = normalizeServerOrderMatrixList([
      { orderKey: ORDER_KEY, packageId: PACKAGE_UUID, developmentId: 'dev-001' },
      null,
      {},
      { packageId: PACKAGE_UUID },
    ]);

    expect(matrices).toHaveLength(1);
    expect(matrices[0].orderKey).toBe(ORDER_KEY);
    expect(matrices[0].packageUuid).toBe(PACKAGE_UUID);
  });
});
