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

test('accepts the canonical Change Exposure identity and preserves legacy component identities', () => {
  for (const component of [
    'systemForecast',
    'changeExposure',
    'expectedLiability',
    'vaExposureUplift',
    'commercialAdjustment',
  ]) {
    const result = validatePatchPeriodBody({ version: 1, commentary: {
      movementExplanations: [explanation({ component })],
    } });
    assert.equal(result.ok, true, component);
  }
});

test('rejects an arbitrary movement component identity', () => {
  const result = validatePatchPeriodBody({ version: 1, commentary: {
    movementExplanations: [explanation({ component: 'madeUpComponent' })],
  } });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /invalid Cost Code\/component identity/);
});

test('keeps distinct System Forecast and Change Exposure explanations across refresh and edit', () => {
  const firstRecordedAt = '2026-10-01T13:51:05.832Z';
  const secondRecordedAt = '2026-10-01T14:10:00.000Z';
  const auth = { displayName: 'David Morris', userId: 'user-1', membershipId: 'membership-1' };
  const system = explanation({
    costCodeKey: '3000', component: 'systemForecast', fingerprint: 'p01|snap|3000|systemForecast|7320000',
    unexplainedAmount: 73200, reason: 'Approved order and issued VO movement',
  });
  const change = explanation({
    costCodeKey: '3000', component: 'changeExposure', fingerprint: 'p01|snap|3000|changeExposure|400000',
    unexplainedAmount: 4000, reason: 'Muck-away variation remains outside Current Contract',
  });

  const first = stampMovementExplanations([system], [], { auth, now: () => firstRecordedAt });
  const validated = validatePatchPeriodBody({ version: 6, commentary: {
    movementExplanations: [...first, change],
  } });
  assert.equal(validated.ok, true);
  const refreshed = stampMovementExplanations(validated.value.commentary.movementExplanations, first, {
    auth, now: () => secondRecordedAt,
  });
  assert.equal(refreshed.length, 2);
  assert.deepEqual(refreshed.map((item) => [item.component, item.unexplainedAmount]), [
    ['systemForecast', 73200], ['changeExposure', 4000],
  ]);
  assert.equal(refreshed[0].recordedAt, firstRecordedAt);
  assert.equal(refreshed[1].recordedAt, secondRecordedAt);

  const editedChange = { ...change, reason: 'Updated Change Exposure explanation' };
  const edited = stampMovementExplanations([refreshed[0], editedChange], refreshed, {
    auth, now: () => '2026-10-01T14:20:00.000Z',
  });
  assert.equal(edited.length, 2);
  assert.equal(edited[0].reason, system.reason);
  assert.equal(edited[0].recordedAt, firstRecordedAt);
  assert.equal(edited[1].reason, editedChange.reason);
  assert.equal(edited[1].recordedAt, '2026-10-01T14:20:00.000Z');

  const editedSystem = { ...system, reason: 'Updated System Forecast explanation' };
  const systemEdited = stampMovementExplanations([editedSystem, edited[1]], edited, {
    auth, now: () => '2026-10-01T14:30:00.000Z',
  });
  assert.equal(systemEdited.length, 2);
  assert.equal(systemEdited[0].reason, editedSystem.reason);
  assert.equal(systemEdited[0].recordedAt, '2026-10-01T14:30:00.000Z');
  assert.equal(systemEdited[1].reason, editedChange.reason);
  assert.equal(systemEdited[1].recordedAt, '2026-10-01T14:20:00.000Z');
});
