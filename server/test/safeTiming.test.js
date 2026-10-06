const test = require('node:test');
const assert = require('node:assert/strict');
const { recordTiming, timingStart } = require('../utils/safeTiming');

test('server timing evidence is allowlisted and duration-only', () => {
  const calls=[];
  const original=console.info;
  console.info=(...args)=>calls.push(args);
  try {
    recordTiming('server_auth_me_total',timingStart());
    recordTiming('provider-user-secret',timingStart());
  } finally { console.info=original; }
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'[buildlite-timing]');
  assert.deepEqual(Object.keys(calls[0][1]).sort(),['durationMs','event']);
  assert.equal(calls[0][1].event,'server_auth_me_total');
  assert.doesNotMatch(JSON.stringify(calls),/token|email|tenant|database|authorization|cookie|secret/i);
});
