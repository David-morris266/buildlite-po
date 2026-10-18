const test = require('node:test');
const assert = require('node:assert/strict');
const { getHomeDashboard, orderAttention, OPEN_CE_STATUSES, MAX_ATTENTION, MAX_ACTIVITY } = require('../services/homeDashboardService');
const { PERMISSIONS: P } = require('../auth/permissions');

const auth = permissions => ({ clientId: 'tenant-a', userId: 'user-a', permissions });
const result = rows => ({ rows });

test('dashboard status definitions separate monthly CVRs and filter governed queues', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT\n      (SELECT COUNT')) return result([{ live_developments: 2, submitted_cvrs: 1, open_commercial_events: 5 }]);
    if (sql.includes('FROM cvr_periods p')) return result([{ id: 'p1', period_key: 'P03', period_label: 'P03', submitted_at: '2026-10-01', submitted_by: 'QS', development_id: 'd1', development_name: 'Oak' }]);
    if (sql.includes('FROM commercial_events e JOIN')) return result([{ id: 'ce1', event_number: 'CE-1', description: 'Drainage', status: 'submitted', updated_at: '2026-10-02', development_id: 'd1', development_name: 'Oak' }]);
    if (sql.includes('WITH activity AS')) return result([]);
    throw new Error('Unexpected query');
  };
  const dashboard = await getHomeDashboard(auth([P.COMMERCIAL_READ, P.CVR_LOCK, P.CE_APPROVE, P.PAYMENT_APPROVAL_RUN_VIEW, P.PAYMENT_RELEASE_EXECUTE]), {
    query,
    listPaymentApprovalQueue: async () => [{ certificateId: 'cert1', workflowState: 'awaiting_approval', certificateNumber: 4, development: 'Oak', subcontractor: 'Groundworks', submittedAt: '2026-10-03' }, { certificateId: 'cert2', workflowState: 'authorised' }],
    listPaymentReleaseQueue: async () => [{ certificateId: 'cert3', workflowState: 'ready', certificateNumber: 3, development: 'Oak', subcontractor: 'Brickwork', finalPaymentDate: '2026-10-20' }, { certificateId: 'cert4', workflowState: 'released' }],
  });
  assert.equal(dashboard.overview.metrics.cvrAwaitingApproval.value, 1);
  assert.equal(dashboard.overview.metrics.certificatesRequiringReview.value, 1);
  assert.deepEqual(dashboard.attention.items.map(item => item.id).sort(), ['accounts:cert3', 'certificate:cert1', 'ce:ce1', 'cvr:p1'].sort());
  const core = calls.find(call => call.sql.includes('SELECT\n      (SELECT COUNT'));
  assert.match(core.sql, /period_type='monthly_cvr'/);
  assert.match(core.sql, /status='submitted'/);
  assert.deepEqual(core.params[1], OPEN_CE_STATUSES);
  assert.doesNotMatch(core.sql, /rejected|closed/);
});

test('permission filtering does not call or disclose restricted worklists', async () => {
  let approvalCalls = 0; let releaseCalls = 0;
  const dashboard = await getHomeDashboard(auth([P.COMMERCIAL_READ]), {
    query: async sql => sql.includes('WITH activity AS') ? result([]) : sql.includes('FROM commercial_events e JOIN') ? result([]) : result([{ live_developments: 1, submitted_cvrs: 4, open_commercial_events: 2 }]),
    listPaymentApprovalQueue: async () => { approvalCalls += 1; return []; },
    listPaymentReleaseQueue: async () => { releaseCalls += 1; return []; },
  });
  assert.equal(dashboard.overview.metrics.cvrAwaitingApproval.state, 'restricted');
  assert.equal(dashboard.overview.metrics.certificatesRequiringReview.state, 'restricted');
  assert.equal(approvalCalls, 0); assert.equal(releaseCalls, 0);
  assert.equal(dashboard.attention.items.length, 0);
});

test('section failures remain unavailable rather than becoming zero', async () => {
  const dashboard = await getHomeDashboard(auth([P.COMMERCIAL_READ, P.PAYMENT_APPROVAL_RUN_VIEW]), {
    query: async sql => sql.includes('WITH activity AS') ? Promise.reject(new Error('audit unavailable')) : sql.includes('FROM commercial_events e JOIN') ? result([]) : result([{ live_developments: 1, submitted_cvrs: 0, open_commercial_events: 0 }]),
    listPaymentApprovalQueue: async () => { throw new Error('queue unavailable'); },
  });
  assert.equal(dashboard.overview.metrics.certificatesRequiringReview.state, 'unavailable');
  assert.equal(dashboard.attention.state, 'unavailable');
  assert.deepEqual(dashboard.attention.unavailableSources, ['certificates']);
  assert.equal(dashboard.activity.state, 'unavailable');
});

test('activity query is tenant scoped, bounded and chronological', async () => {
  let activityQuery;
  await getHomeDashboard(auth([P.COMMERCIAL_READ]), { query: async (sql, params) => {
    if (sql.includes('WITH activity AS')) { activityQuery = { sql, params }; return result([{ kind: 'purchase_order', source_id: 'S1:1', action: 'issued', actor: 'A', created_at: '2026-10-01', title: 'Purchase Order S1', development_id: null, reference: 'S1' }]); }
    if (sql.includes('FROM commercial_events e JOIN')) return result([]);
    return result([{ live_developments: 0, submitted_cvrs: 0, open_commercial_events: 0 }]);
  } });
  assert.equal(activityQuery.params[0], 'tenant-a');
  assert.equal(activityQuery.params[1], MAX_ACTIVITY);
  assert.match(activityQuery.sql, /ORDER BY created_at DESC/);
  assert.ok((activityQuery.sql.match(/client_id=\$1/g) || []).length >= 4);
});

test('attention ordering normalises dates, respects type priority, and truncates only afterwards', () => {
  const items = [
    { id: 'accounts-future', kind: 'accounts', timestamp: '2027-01-01T00:00:00.000Z' },
    { id: 'certificate-old', kind: 'certificate', timestamp: new Date('2025-01-01T00:00:00.000Z') },
    { id: 'cvr-invalid', kind: 'cvr', timestamp: 'not-a-date' },
    { id: 'cvr-new', kind: 'cvr', timestamp: '2026-10-12T09:00:00.000Z' },
    { id: 'cvr-old', kind: 'cvr', timestamp: new Date('2026-10-10T09:00:00.000Z') },
    { id: 'ce-missing', kind: 'commercial_event', timestamp: null },
    { id: 'ce-valid', kind: 'commercial_event', timestamp: '2026-10-11T09:00:00.000Z' },
    { id: 'certificate-new', kind: 'certificate', timestamp: '2026-10-13T09:00:00.000Z' },
    { id: 'accounts-earlier', kind: 'accounts', timestamp: new Date('2026-10-20T00:00:00.000Z') },
    { id: 'unknown', kind: 'other', timestamp: '2020-01-01T00:00:00.000Z' },
  ];
  const ordered = orderAttention(items);
  assert.deepEqual(ordered.map(item => item.id), [
    'cvr-old', 'cvr-new', 'cvr-invalid',
    'certificate-old', 'certificate-new',
    'ce-valid', 'ce-missing',
    'accounts-earlier', 'accounts-future',
    'unknown',
  ]);
  assert.deepEqual(ordered.slice(0, MAX_ATTENTION).map(item => item.id), [
    'cvr-old', 'cvr-new', 'cvr-invalid', 'certificate-old', 'certificate-new', 'ce-valid', 'ce-missing', 'accounts-earlier',
  ]);
});
