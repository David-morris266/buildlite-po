import { describe, expect, it } from 'vitest';
import {
  buildServerLedgerBatchFixture,
  buildServerLedgerTransactionFixture,
} from '../test/mockPurchaseLedgerApi';
import {
  normalizeServerLedgerTotals,
  normalizeServerLedgerTransaction,
  normalizeServerLedgerTransactionList,
} from './ledgerServerMapper';

describe('ledger mappers (BL-031B)', () => {
  it('maps ledger transactions into camelCase store shape', () => {
    const mapped = normalizeServerLedgerTransaction(
      buildServerLedgerTransactionFixture({
        supplier: 'Wipe It Cleaners',
        supplierCode: 'WIC',
        costCodeKey: '5231',
        transactionDate: '2026-01-15',
        invoiceNumber: 'INV-1',
        description: 'January invoice',
        netAmount: 1000,
        vatAmount: 200,
        grossAmount: 1200,
        source: 'Sage Purchase Ledger',
        documentType: 'Invoice',
        reference: 'REF-1',
        batchId: 'batch-1',
        fingerprint: 'abc123',
        reversesId: null,
      })
    );

    expect(mapped.id).toBeTruthy();
    expect(mapped.supplier).toBe('Wipe It Cleaners');
    expect(mapped.supplierCode).toBe('WIC');
    expect(mapped.costCode).toBe('5231');
    expect(mapped.costCodeKey).toBe('5231');
    expect(mapped.invoiceNumber).toBe('INV-1');
    expect(mapped.description).toBe('January invoice');
    expect(mapped.netAmount).toBe(1000);
    expect(mapped.vat).toBe(200);
    expect(mapped.vatAmount).toBe(200);
    expect(mapped.grossAmount).toBe(1200);
    expect(mapped.source).toBe('Sage Purchase Ledger');
    expect(mapped.documentType).toBe('Invoice');
    expect(mapped.reference).toBe('REF-1');
    expect(mapped.importBatch).toBe('batch-1');
    expect(mapped.batchId).toBe('batch-1');
    expect(mapped.fingerprint).toBe('abc123');
    expect(JSON.stringify(mapped)).not.toMatch(/cost_code_key|vat_amount|batch_id/);
    expect(normalizeServerLedgerTransactionList([mapped])).toHaveLength(1);
  });

  it('maps ledger totals', () => {
    const mapped = normalizeServerLedgerTotals({
      totalNet: 1500,
      totalVat: 300,
      transactionCount: 2,
      actualCostByCostCode: { '5231': 1500 },
    });

    expect(mapped.totalNet).toBe(1500);
    expect(mapped.totalVat).toBe(300);
    expect(mapped.transactionCount).toBe(2);
    expect(mapped.actualCostByCostCode['5231']).toBe(1500);
    expect(JSON.stringify(mapped)).not.toMatch(/total_net|actual_cost_by_cost_code/);
  });

  it('maps batch file metadata onto import-history fields', () => {
    const batch = buildServerLedgerBatchFixture();
    expect(batch.originalFileName).toBe('actuals.csv');
  });
});
