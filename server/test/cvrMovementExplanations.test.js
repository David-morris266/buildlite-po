const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePatchPeriodBody } = require('../services/cvrPeriodValidation');
const { stampMovementExplanations } = require('../services/cvrMovementExplanations');

const explanation = (overrides = {}) => ({
  costCodeKey: '4120', component: 'systemForecast', previousPeriodId: 'previous',
  previousSnapshotId: 'snapshot', fingerprint: 'fingerprint', unexplainedAmount: 500,
  reason: 'Revised planting scope', ...overrides,
});

test('movement explanation validation keeps the whole-residual intent and strips forged actor provenance', () => {
  const result = validatePatchPeriodBody({ version: 2, commentary: {
    movementExplanations: [explanation({ actor: 'Forged', membershipId: 'forged' })],
  } });
  assert.equal(result.ok, true);
  assert.equal(result.value.commentary.movementExplanations[0].actor, undefined);
  assert.equal(result.value.commentary.movementExplanations[0].membershipId, undefined);
});

test('server stamps authenticated provenance and preserves it on an unchanged replay', () => {
  const now = () => '2026-09-17T12:00:00.000Z';
  const auth = { displayName: 'David Morris', userId: 'user-1', membershipId: 'membership-1' };
  const first = stampMovementExplanations([explanation()], [], { auth, now });
  assert.deepEqual(first[0], { ...explanation(), actor: 'David Morris', userId: 'user-1', membershipId: 'membership-1', recordedAt: now() });
  const replay = stampMovementExplanations([explanation()], first, { auth: { displayName: 'Another user' }, now: () => 'later' });
  assert.equal(replay[0].actor, 'David Morris');
  assert.equal(replay[0].recordedAt, now());
});

test('zero residual and missing reasons are rejected', () => {
  const result = validatePatchPeriodBody({ version: 1, commentary: {
    movementExplanations: [explanation({ unexplainedAmount: 0, reason: '' })],
  } });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /reason is required/);
  assert.match(result.errors.join(' '), /must be non-zero/);
});
