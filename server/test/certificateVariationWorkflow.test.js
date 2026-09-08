const test = require('node:test');
const assert = require('node:assert/strict');
const { authorityCandidates } = require('../services/certificateVariationWorkflow');

test('historic normal-source VO supersedes its approved CE without a line-allocation bridge', async () => {
  const db = { query: async sql => {
    if (sql.includes('FROM commercial_events')) return { rows: [{ id: 'ce-9', event_number: 'CE-0009', description: 'Greenleaf change', value: '5000', status: 'approved' }] };
    if (sql.includes('FROM variation_order_line_commercial_event_allocations')) return { rows: [] };
    return { rows: [{ commercial_event_id: 'ce-9', source_id: 'vo-line-1', source_value: '4500', lineage_value: '4500', variation_order_id: 'vo-1', variation_order_number: 'VO-0001', source_po_number: 'S0001', status: 'issued', description: 'Greenleaf change', provenance_model: 'normal_source' }] };
  } };
  const rows = await authorityCandidates(db, 'client-1', 'package-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reference, 'CE-0009');
  assert.equal(rows[0].sourceType, 'variation_order_line');
  assert.equal(rows[0].currentAuthority, 4500);
  assert.notEqual(rows[0].currentAuthority, 9500);
  assert.equal(rows[0].provenance.provenanceModel, 'normal_source');
});

test('explicit line allocation provenance remains supported and takes precedence', async () => {
  const explicit = { commercial_event_id: 'ce-9', source_id: 'vo-line-1', source_value: '4500', lineage_value: '4500', variation_order_id: 'vo-1', variation_order_number: 'VO-0001', source_po_number: 'S0001', provenance_model: 'line_allocation' };
  const db = { query: async sql => sql.includes('FROM commercial_events')
    ? { rows: [{ id: 'ce-9', event_number: 'CE-0009', description: 'Greenleaf change', value: '5000', status: 'approved' }] }
    : sql.includes('FROM variation_order_line_commercial_event_allocations') ? { rows: [explicit] } : { rows: [{ ...explicit, source_id: 'wrong-normal-line', provenance_model: 'normal_source' }] } };
  const rows = await authorityCandidates(db, 'client-1', 'package-1');
  assert.equal(rows[0].sourceId, 'vo-line-1');
  assert.equal(rows[0].currentAuthority, 4500);
  assert.equal(rows[0].provenance.provenanceModel, 'line_allocation');
});

test('ambiguous multi-line VO lineage is review-required rather than guessed', async () => {
  const db = { query: async sql => sql.includes('FROM commercial_events')
    ? { rows: [{ id: 'ce-9', event_number: 'CE-0009', description: 'Split change', value: '5000', status: 'approved' }] }
    : sql.includes('FROM variation_order_line_commercial_event_allocations') ? { rows: [] } : { rows: [
      { commercial_event_id: 'ce-9', source_id: 'line-1', lineage_value: '2500' },
      { commercial_event_id: 'ce-9', source_id: 'line-2', lineage_value: '2000' },
    ] } };
  const rows = await authorityCandidates(db, 'client-1', 'package-1');
  assert.equal(rows[0].reviewRequired, true);
  assert.equal(rows[0].currentAuthority, null);
});
