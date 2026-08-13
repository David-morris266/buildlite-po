import { describe, expect, it } from 'vitest';
import {
  normalizeServerCommercialEvent,
  normalizeServerCommercialEventList,
} from './commercialEventServerMapper';

const ORDER_KEY = 'dev-001::sup-spark::0120';
const PACKAGE_UUID = 'pkg-uuid-spark-001';

describe('commercialEventServerMapper', () => {
  it('normalises server document to client shape with packageId as orderKey', () => {
    const document = {
      id: 'ce-001',
      event_number: 'CE-1001',
      development_id: 'dev-001',
      package_uuid: PACKAGE_UUID,
      packageId: ORDER_KEY,
      order_key: ORDER_KEY,
      event_type: 'variation',
      category: 'design',
      subcategory: '',
      responsibility: 'employer',
      description: 'Approved variation',
      value: 20000,
      financial_treatment: 'contractAmendment',
      vat_treatment: 'standard',
      date_raised: '2026-01-15',
      status: 'approved',
      linked_event_id: null,
      recovery_status: 'notApplicable',
      certificate_status: 'notIncluded',
      recovered_amount: 0,
      version: 2,
      auditHistory: [
        {
          id: 'audit-1',
          action: 'APPROVED',
          created_at: '2026-01-16T10:00:00.000Z',
          actor: 'Manager',
          prior_status: 'submitted',
          new_status: 'approved',
        },
      ],
    };

    const event = normalizeServerCommercialEvent(document);

    expect(event.id).toBe('ce-001');
    expect(event.eventNumber).toBe('CE-1001');
    expect(event.developmentId).toBe('dev-001');
    expect(event.packageId).toBe(ORDER_KEY);
    expect(event.orderKey).toBe(ORDER_KEY);
    expect(event.packageUuid).toBe(PACKAGE_UUID);
    expect(event.value).toBe(20000);
    expect(event.status).toBe('approved');
    expect(event.recoveryStatus).toBe('notApplicable');
    expect(event.certificateStatus).toBe('notIncluded');
    expect(event.recoveredAmount).toBe(0);
    expect(event.version).toBe(2);
    expect(event.auditHistory).toHaveLength(1);
    expect(event.auditHistory[0].action).toBe('APPROVED');
    expect(event.auditHistory[0].timestamp).toBe('2026-01-16T10:00:00.000Z');
  });

  it('preserves packageUuid separately from orderKey packageId', () => {
    const event = normalizeServerCommercialEvent({
      id: 'ce-002',
      packageUuid: PACKAGE_UUID,
      orderKey: ORDER_KEY,
      developmentId: 'dev-001',
      eventNumber: 'CE-1002',
      eventType: 'variation',
      category: 'design',
      responsibility: 'employer',
      description: 'Test',
      value: 1000,
      status: 'draft',
      version: 1,
    });

    expect(event.packageId).toBe(ORDER_KEY);
    expect(event.packageUuid).toBe(PACKAGE_UUID);
    expect(event.packageId).not.toBe(PACKAGE_UUID);
  });

  it('normalises a list and drops invalid entries', () => {
    const events = normalizeServerCommercialEventList([
      {
        id: 'ce-003',
        packageId: ORDER_KEY,
        developmentId: 'dev-001',
        eventNumber: 'CE-1003',
        eventType: 'variation',
        category: 'design',
        responsibility: 'employer',
        description: 'Valid',
        value: 500,
        status: 'draft',
        version: 1,
      },
      null,
      {},
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].packageId).toBe(ORDER_KEY);
  });
});
