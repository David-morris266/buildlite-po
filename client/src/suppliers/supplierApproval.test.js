import { describe, expect, it } from 'vitest';
import {
  appendSupplierApprovalHistory,
  buildSupplierCreatePayload,
  getSupplierApprovalBadge,
  isSupplierApproved,
} from './supplierApproval';
import { buildLedgerImportCrossCheck } from '../ledger/ledgerImportCrossCheck';

describe('supplierApproval', () => {
  it('marks PO-created suppliers as pending approval', () => {
    const payload = buildSupplierCreatePayload({ name: 'New Subcontractor Ltd' }, { createdFromPo: true });
    expect(payload.approvedSupplier).toBe(false);
    expect(payload.approvalStatus).toBe('pending');
    expect(payload.pendingApproval).toBe(true);
  });

  it('exposes pending and approved badges', () => {
    expect(getSupplierApprovalBadge({ approvalStatus: 'pending' }).label).toBe('Pending Supplier');
    expect(getSupplierApprovalBadge({ approvedSupplier: true }).label).toBe('Approved');
    expect(isSupplierApproved({ approvedSupplier: true })).toBe(true);
    expect(isSupplierApproved({ approvalStatus: 'pending' })).toBe(false);
  });

  it('records approval history entries', () => {
    const history = appendSupplierApprovalHistory({}, 'APPROVED', 'Finance Director', 'Approved in Administration');
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe('APPROVED');
  });
});

describe('ledgerImportCrossCheck', () => {
  it('compares CSV totals with BuildLite import totals', () => {
    const parsedState = {
      headerRowIndex: 0,
      fieldByColumn: ['transactionAmount', 'supplier', 'costCode', 'transactionDate', 'description'],
      rows: [
        ['Amount', 'Supplier', 'Code', 'Date', 'Description'],
        ['100.00', 'Acme', 'BRK', '2026-01-01', 'Bricks'],
        ['50.00', 'Acme', 'ROOF', '2026-01-02', 'Roof'],
        ['', '', '', '', ''],
      ],
    };

    const validationResult = {
      importedCount: 1,
      totalValue: 100,
    };

    const crossCheck = buildLedgerImportCrossCheck(parsedState, validationResult);
    expect(crossCheck.csvTotal).toBe(150);
    expect(crossCheck.buildliteTotal).toBe(100);
    expect(crossCheck.difference).toBe(50);
    expect(crossCheck.balanced).toBe(false);
  });
});
