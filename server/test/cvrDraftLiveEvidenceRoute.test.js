const test = require('node:test');
const assert = require('node:assert/strict');
const { createDraftCvrLiveEvidenceHandler } = require('../routes/cvrRoutes');

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    set(headers) { Object.assign(this.headers, headers); return this; },
    json(body) { this.body = body; return this; },
  };
}

const request = () => ({
  buildliteAuth: { clientId: 'tenant-valhalla' },
  params: { developmentId: 'welford', periodId: 'period-site-start' },
});

test('Draft live evidence exposes the existing governed cost close without requiring Revenue readiness', async () => {
  let options;
  const handler = createDraftCvrLiveEvidenceHandler({
    databaseConfigured: () => true,
    loadPeriod: async () => ({ ok: true, period: {
      status: 'draft',
      budgetSource: { document: { positions: [] } },
      variationExposure: { document: { items: [] } },
      commercialHierarchy: { document: { costCodes: [] } },
    } }),
    buildCandidate: async (received) => {
      options = received;
      return { ready: true, complete: true, snapshot: { rows: [{ costCodeKey: '5545', committed: 126894.54 }] } };
    },
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.evidence.rows[0].committed, 126894.54);
  assert.equal(options.clientId, 'tenant-valhalla');
  assert.equal(options.developmentId, 'welford');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('live evidence rejects non-Draft periods and incomplete governed evidence', async () => {
  const submitted = createDraftCvrLiveEvidenceHandler({
    databaseConfigured: () => true,
    loadPeriod: async () => ({ ok: true, period: { status: 'submitted' } }),
    buildCandidate: async () => { throw new Error('must not run'); },
  });
  const submittedResponse = response();
  await submitted(request(), submittedResponse);
  assert.equal(submittedResponse.statusCode, 409);

  const incomplete = createDraftCvrLiveEvidenceHandler({
    databaseConfigured: () => true,
    loadPeriod: async () => ({ ok: true, period: { status: 'draft' } }),
    buildCandidate: async () => ({ ready: false, complete: false, blockers: [{ source: 'variationOrders', reason: 'query-failed' }] }),
  });
  const incompleteResponse = response();
  await incomplete(request(), incompleteResponse);
  assert.equal(incompleteResponse.statusCode, 409);
  assert.deepEqual(incompleteResponse.body.blockers, [{ source: 'variationOrders', reason: 'query-failed' }]);
});
