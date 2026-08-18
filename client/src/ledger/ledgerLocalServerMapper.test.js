import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLedgerFingerprint } from './ledgerFingerprint';
import {
  groupLocalLedgerBatches,
  mapLocalLedgerTransaction,
  readLocalLedgerDevelopment,
} from './ledgerLocalServerMapper';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

describe('ledger local→server mapper (BL-031C)', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('maps transaction money and evidence fields without changing values', () => {
    const mapped = mapLocalLedgerTransaction({
      supplier: 'Wipe It Cleaners',
      supplierCode: 'WIC',
      costCode: '5231',
      transactionDate: '2026-01-15T00:00:00.000Z',
      invoiceNumber: 'INV-1',
      description: 'January invoice',
      netAmount: 1000,
      vat: 200,
      grossAmount: 1200,
      source: 'Sage Purchase Ledger',
      documentType: 'Invoice',
      reference: 'REF-1',
      importBatch: 'batch-1',
    });
    expect(mapped.ok).toBe(true);
    expect(mapped.value.netAmount).toBe(1000);
    expect(mapped.value.vatAmount).toBe(200);
    expect(mapped.value.grossAmount).toBe(1200);
    expect(mapped.value.transactionDate).toBe('2026-01-15');
    expect(mapped.value.costCodeKey).toBe('5231');
  });

  it('groups by existing local import batch and otherwise uses a labelled migration batch', () => {
    const grouped = groupLocalLedgerBatches({
      developmentId: 'dev-1',
      developmentName: 'Test Site 1',
      importHistory: [
        { id: 'import-1', importBatch: 'batch-1', fileName: 'sage-export.csv', importProfile: 'Sage Purchase Ledger' },
      ],
      transactions: [
        { importBatch: 'batch-1', netAmount: 1000 },
        { importBatch: '', netAmount: 50 },
      ],
    });
    expect(grouped).toHaveLength(2);
    expect(grouped[0].originalFileName).toBe('sage-export.csv');
    expect(grouped[1].originalFileName).toBe('LocalStorage migration - Test Site 1');
  });

  it('builds the same fingerprint as the server algorithm', async () => {
    const mapped = mapLocalLedgerTransaction({
      supplier: 'Wipe It Cleaners',
      invoiceNumber: 'INV-1',
      transactionDate: '2026-01-15',
      netAmount: 1000,
      costCode: '5231',
    }).value;
    const fingerprint = await buildLedgerFingerprint(mapped);
    expect(fingerprint).toHaveLength(64);
  });

  it('does not invent a ledger record for a missing development', () => {
    expect(readLocalLedgerDevelopment('dev-missing').exists).toBe(false);
    expect(readLocalLedgerDevelopment('dev-missing').transactions).toEqual([]);
  });
});
