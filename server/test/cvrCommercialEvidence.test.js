const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSubcontractOrderKey } = require('../services/packageKey');
const { buildCvrCloseCandidate } = require('../services/cvrCloseEngine');
const { sourceOk } = require('../services/cvrCloseSources');
const {
  buildCommercialEvidenceByCostCode,
  stripReservedCommercialEvidence,
} = require('../services/cvrCommercialEvidence');
const { validateCostCodeInputBody } = require('../services/cvrPeriodValidation');

function sources({ po, variationOrders = [], events = [], inputs = [] }) {
  return {
    development: sourceOk({ id: 'dev-welford' }),
    period: sourceOk({ id: 'period-p01', periodKey: 'P01', periodType: 'monthly_cvr', commentary: {} }),
    inputs: sourceOk(inputs), purchaseOrders: sourceOk(po ? (Array.isArray(po) ? po : [po]) : []),
    commercialEvents: sourceOk(events), variationOrders: sourceOk(variationOrders),
    certificates: sourceOk([]), ledger: sourceOk([]),
  };
}

function po(costCode = '5545', amount = 125894.54) {
  return {
    poNumber: 'S0016', type: 'S', status: 'approved', supplierId: 'supplier-boundary',
    supplierName: 'Boundary Fencing Contractors Ltd', subtotal: amount,
    costRef: { costCode }, approval: { status: 'approved', history: [
      { action: 'approved', by: 'Commercial Director', at: '2026-10-30T10:00:00.000Z' },
    ] },
  };
}

test('real close engine proves Welford fencing commitment is absorbed by allowance', async () => {
  const orderKey = buildSubcontractOrderKey('dev-welford', 'supplier-boundary', '5545');
  const purchaseOrder = po();
  const candidate = await buildCvrCloseCandidate({
    clientId: 'tenant-valhalla', developmentId: 'dev-welford', periodId: 'period-p01',
    loadSources: async () => ({ ok: true, sources: sources({
      po: purchaseOrder,
      variationOrders: [{ id: 'vo-1', packageId: 'package-boundary', orderKey, sourcePoNumber: 'S0016', variationOrderNumber: 'VO-0001',
        displayReference: 'S0016/VO-0001', description: 'Boundary fencing instruction', status: 'issued',
        signedValue: 1000, issuedBy: 'Commercial Director', issuedAt: '2026-11-02T09:00:00.000Z', sourceCommercialEvents: [] }],
    }) }),
    variationExposureDocument: { items: [] },
    developmentBudgetDocument: { positions: [{ costCode: '5545', description: 'Plot Fencing', originalPence: 12716620, currentPence: 12716620 }] },
    commercialHierarchyDocument: { costCodes: [] },
  });
  assert.equal(candidate.ready, true);
  const row = candidate.snapshot.rows.find((item) => item.costCodeKey === '5545');
  assert.equal(row.currentBudget, 127166.2);
  assert.equal(row.committed, 126894.54);
  assert.equal(row.uncommittedForecast, 271.66);
  assert.equal(row.finalForecast, 127166.2);
  const evidence = row.displayMetadata.commercialEvidence;
  assert.equal(evidence.commitment.total, 126894.54);
  assert.deepEqual(evidence.commitment.items.map((item) => [item.reference, item.includedAmount]), [
    ['S0016', 125894.54], ['S0016/VO-0001', 1000],
  ]);
  assert.equal(evidence.commitment.items[1].authority.actor, 'Commercial Director');
  assert.deepEqual(evidence.commitment.items[1].navigation, {
    type: 'variation_order', variationOrderId: 'vo-1', packageId: 'package-boundary', orderKey,
  });
});

test('real close engine proves Welford drainage VO raises commitment and EFC by £1,750', async () => {
  const orderKey = buildSubcontractOrderKey('dev-welford', 'supplier-boundary', '5470');
  const candidate = await buildCvrCloseCandidate({
    clientId: 'tenant-valhalla', developmentId: 'dev-welford', periodId: 'period-p01',
    loadSources: async () => ({ ok: true, sources: sources({
      po: po('5470', 351716.53),
      variationOrders: [{ id: 'vo-drainage', packageId: 'package-drainage', orderKey, sourcePoNumber: 'S0016',
        variationOrderNumber: 'VO-0002', displayReference: 'S0016/VO-0002',
        description: 'Plot drainage uplift', status: 'issued', signedValue: 1750,
        issuedBy: 'Commercial Director', issuedAt: '2026-11-03T09:00:00.000Z', sourceCommercialEvents: [] }],
    }) }),
    variationExposureDocument: { items: [] },
    developmentBudgetDocument: { positions: [{ costCode: '5470', description: 'Plot Drainage', originalPence: 35171653, currentPence: 35171653 }] },
    commercialHierarchyDocument: { costCodes: [] },
  });
  const row = candidate.snapshot.rows.find((item) => item.costCodeKey === '5470');
  assert.equal(row.committed, 353466.53);
  assert.equal(row.uncommittedForecast, 0);
  assert.equal(row.systemForecast, 353466.53);
  assert.equal(row.finalForecast, 353466.53);
  assert.equal(row.displayMetadata.commercialEvidence.commitment.items.at(-1).includedAmount, 1750);
  assert.equal(row.displayMetadata.commercialEvidence.commitment.items.at(-1).navigation.variationOrderId, 'vo-drainage');
});

test('evidence follows effective CE/VO authority through replacement, supersession, reversal and omission', async () => {
  const purchaseOrder = po('5470', 351716.53);
  const orderKey = buildSubcontractOrderKey('dev-welford', 'supplier-boundary', '5470');
  const events = [{ id: 'ce-1', orderKey, costCode: '5470', status: 'approved', value: 1750,
    eventNumber: 'CE-0001', description: 'Drainage change' }];
  const variationOrders = [
      { id: 'vo-1', orderKey, status: 'issued', signedValue: 1750, displayReference: 'S0016/VO-0001', sourceCommercialEvents: [{ commercialEventId: 'ce-1' }] },
      { id: 'vo-2', orderKey, status: 'issued', signedValue: 500, displayReference: 'S0016/VO-0002', supersedesId: 'vo-1', sourceCommercialEvents: [{ commercialEventId: 'ce-1' }] },
      { id: 'vo-3', orderKey, status: 'issued', signedValue: -500, displayReference: 'S0016/VO-0003', reversesId: 'vo-2' },
      { id: 'vo-4', orderKey, status: 'issued', signedValue: -250, displayReference: 'S0016/VO-0004' },
    ];
  const candidate = await buildCvrCloseCandidate({ clientId: 'tenant-valhalla', developmentId: 'dev-welford', periodId: 'period-p01',
    loadSources: async () => ({ ok: true, sources: sources({ po: purchaseOrder, events, variationOrders }) }),
    variationExposureDocument: { items: [] }, commercialHierarchyDocument: { costCodes: [] } });
  const docs = candidate.snapshot.rows.find((row) => row.costCodeKey === '5470').displayMetadata.commercialEvidence;
  const byReference = new Map(docs.commitment.items.map((item) => [item.reference, item]));
  assert.equal(byReference.get('CE-0001').includedAmount, 0);
  assert.equal(byReference.get('S0016/VO-0001').includedAmount, 0);
  assert.equal(byReference.get('S0016/VO-0002').includedAmount, 500);
  assert.equal(byReference.get('S0016/VO-0002').navigation.type, 'variation_order');
  assert.equal(byReference.get('S0016/VO-0002').navigation.variationOrderId, 'vo-2');
  assert.equal(byReference.get('S0016/VO-0003').includedAmount, -500);
  assert.equal(byReference.get('S0016/VO-0004').includedAmount, -250);
  assert.equal(docs.commitment.total, 351466.53);
});

test('reserved commercial evidence metadata is rejected from client authority and rebuilt server-side', () => {
  const parsed = validateCostCodeInputBody({
    costCodeKey: '5545', costCodeLabel: '5545', originalBudget: 1, currentBudget: 1,
    commercialAdjustment: 0, manualAccrual: 0,
    displayMetadata: { commercialEvidence: { captured: true, commitment: { total: 999999 } }, harmless: 'retained' },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.displayMetadata.commercialEvidence, undefined);
  assert.equal(parsed.value.displayMetadata.harmless, 'retained');
  assert.deepEqual(stripReservedCommercialEvidence({ commercialEvidence: { forged: true }, x: 1 }), { x: 1 });
});

test('large ledger evidence remains bounded while preserving authoritative count and total', () => {
  const ledgerTransactions = Array.from({ length: 125 }, (_, index) => ({
    id: `ledger-${index}`, costCodeKey: '5545', netAmount: index + 0.01,
    invoiceNumber: `INV-${index}`, transactionDate: '2026-11-01',
    createdAt: `2026-11-${String((index % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
  }));
  const evidence = buildCommercialEvidenceByCostCode({
    developmentId: 'dev-welford', purchaseOrders: [], commercialEvents: [],
    variationOrders: [], certificates: [], ledgerTransactions, inputs: [],
  }).get('5545').actual;
  assert.equal(evidence.sourceCount, 125);
  assert.equal(evidence.items.length, 50);
  assert.equal(evidence.omittedCount, 75);
  assert.equal(evidence.total, 7751.25);
});

test('VA evidence records only remaining governed uplift and its QS authority', () => {
  const va = { variationAccountItemId: 'va-1', costCode: '5545', reference: 'VA-0001',
    description: 'Fence return', qsForecast: 1750, effectiveVaExposure: 1750,
    authorityAlreadyInCurrentContract: 1000, vaExposureUplift: 750,
    forecastHistory: [{ itemVersion: 2, newValue: 1750, reason: 'QS reviewed excess',
      actor: 'Project QS', createdAt: '2026-11-04T10:00:00.000Z' }] };
  const evidence = buildCommercialEvidenceByCostCode({
    commitmentAuthority: { evidence: new Map(), totals: new Map() },
    changeExposure: { evidence: new Map([['5545', [{ linked: false, va, resultingExposure: 750 }]]]), totals: new Map([['5545', 750]]) },
    certificates: [], ledgerTransactions: [], inputs: [],
  }).get('5545').exposure;
  assert.equal(evidence.total, 750);
  assert.equal(evidence.items[0].amount, 750);
  assert.equal(evidence.items[0].includedAmount, 750);
  assert.equal(evidence.items[0].authority.actor, 'Project QS');
});

test('linked CE and VA exposure uses the authoritative directional envelope once', async () => {
  const event = { id: 'ce-linked', costCode: '5545', status: 'submitted', value: 1000,
    expectedTreatment: 'expected', eventNumber: 'CE-0001' };
  const va = { variationAccountItemId: 'va-linked', sourceCommercialEventId: 'ce-linked',
    costCode: '5545', vaExposureUplift: 1000, reference: 'VA-0001' };
  const candidate = await buildCvrCloseCandidate({ clientId: 'tenant-valhalla', developmentId: 'dev-welford', periodId: 'period-p01',
    loadSources: async () => ({ ok: true, sources: sources({ po: null, events: [event] }) }),
    variationExposureDocument: { items: [va] }, commercialHierarchyDocument: { costCodes: [] } });
  const row = candidate.snapshot.rows.find((entry) => entry.costCodeKey === '5545');
  assert.equal(row.changeExposure, 1000);
  assert.equal(row.displayMetadata.commercialEvidence.exposure.total, 1000);
  assert.equal(row.displayMetadata.commercialEvidence.exposure.supportingTotal, 1000);
  assert.equal(row.displayMetadata.commercialEvidence.exposure.reconciliation, 'reconciled');
  assert.equal(row.displayMetadata.commercialEvidence.exposure.items.length, 1);
});

test('hold and Site Start absorption are reflected from authoritative exposure evidence', async () => {
  const held = { id: 'ce-held', costCode: '5545', status: 'submitted', value: 1000,
    expectedTreatment: 'hold', eventNumber: 'CE-HOLD' };
  const absorbed = { id: 'ce-absorbed', costCode: '5545', status: 'submitted', value: 1500,
    expectedTreatment: 'expected', eventNumber: 'CE-ABS' };
  const candidate = await buildCvrCloseCandidate({ clientId: 'tenant-valhalla', developmentId: 'dev-welford', periodId: 'period-p01',
    loadSources: async () => ({ ok: true, sources: sources({ po: null, events: [held, absorbed] }) }),
    variationExposureDocument: { items: [] },
    developmentBudgetDocument: { positions: [], absorbedChangeExposure: [{ identity: 'ce:ce-absorbed', amountPence: 100000 }] },
    commercialHierarchyDocument: { costCodes: [] } });
  const row = candidate.snapshot.rows.find((entry) => entry.costCodeKey === '5545');
  assert.equal(row.changeExposure, 500);
  assert.equal(row.displayMetadata.commercialEvidence.exposure.total, 500);
  assert.deepEqual(row.displayMetadata.commercialEvidence.exposure.items.map((item) => item.includedAmount), [0, 500]);
});

test('approved CE without an approved source PO is excluded from commitment evidence', async () => {
  const candidate = await buildCvrCloseCandidate({ clientId: 'tenant-valhalla', developmentId: 'dev-welford', periodId: 'period-p01',
    loadSources: async () => ({ ok: true, sources: sources({ po: null, inputs: [{ costCodeKey: '5545', currentBudget: 2000 }],
      events: [{ id: 'orphan-ce', costCode: '5545', status: 'approved', value: 1000, eventNumber: 'CE-ORPHAN' }] }) }), variationExposureDocument: { items: [] },
    commercialHierarchyDocument: { costCodes: [] } });
  const row = candidate.snapshot.rows.find((entry) => entry.costCodeKey === '5545');
  assert.equal(row.committed, 0);
  assert.equal(row.displayMetadata.commercialEvidence.commitment.count, 0);
});

test('missing issue approval actor is not substituted with the VO creator', async () => {
  const orderKey = buildSubcontractOrderKey('dev-welford', 'supplier-boundary', '5545');
  const candidate = await buildCvrCloseCandidate({ clientId: 'tenant-valhalla', developmentId: 'dev-welford', periodId: 'period-p01',
    loadSources: async () => ({ ok: true, sources: sources({ po: po(), variationOrders: [{ id: 'vo-no-actor', orderKey,
      status: 'issued', signedValue: 100, displayReference: 'S0016/VO-0099', createdBy: 'Draft Creator' }] }) }),
    variationExposureDocument: { items: [] }, commercialHierarchyDocument: { costCodes: [] } });
  const evidence = candidate.snapshot.rows.find((row) => row.costCodeKey === '5545')
    .displayMetadata.commercialEvidence.commitment.items.find((entry) => entry.id === 'vo-no-actor');
  assert.equal(evidence.authority.actor, null);
  assert.equal(evidence.authority.action, 'Issued VO');
});
