const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REPORTING_PERIOD_STATES,
  classifyReportingPeriod,
} = require('../services/cvrReportingPeriod');
const {
  validateCreatePeriodBody,
  validatePatchPeriodBody,
} = require('../services/cvrPeriodValidation');

const OCTOBER_8_2026 = new Date('2026-10-08T12:00:00.000Z');

test('classifies closed, current and future Reporting Periods in the UK calendar', () => {
  assert.equal(classifyReportingPeriod('2026-09-01', OCTOBER_8_2026), REPORTING_PERIOD_STATES.CLOSED);
  assert.equal(classifyReportingPeriod('2026-10-01', OCTOBER_8_2026), REPORTING_PERIOD_STATES.CURRENT);
  assert.equal(classifyReportingPeriod('2026-11-01', OCTOBER_8_2026), REPORTING_PERIOD_STATES.FUTURE);
});

test('classification is deterministic at UK month and year boundaries', () => {
  const january = new Date('2027-01-01T00:30:00.000Z');
  assert.equal(classifyReportingPeriod('2026-12', january), REPORTING_PERIOD_STATES.CLOSED);
  assert.equal(classifyReportingPeriod('2027-01', january), REPORTING_PERIOD_STATES.CURRENT);
});

test('create validation retains strict month validation', () => {
  assert.equal(validateCreatePeriodBody({ reportingMonth: '2026-13' }).ok, false);
  assert.equal(validateCreatePeriodBody({ reportingMonth: 'not-a-month' }).ok, false);
});

test('Draft PATCH rejects Reporting Period mutation and permits ordinary commentary PATCH', () => {
  const forbidden = validatePatchPeriodBody({ version: 1, reportingMonth: '2026-09' });
  assert.equal(forbidden.ok, false);
  assert.match(forbidden.errors.join(' '), /cannot be changed after/i);

  const permitted = validatePatchPeriodBody({
    version: 1,
    commentary: { keyCommercialIssues: 'Reviewed' },
  });
  assert.equal(permitted.ok, true);
  assert.equal(permitted.value.commentary.keyCommercialIssues, 'Reviewed');
});
