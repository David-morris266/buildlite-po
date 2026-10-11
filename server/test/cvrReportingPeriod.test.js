const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REPORTING_PERIOD_STATES,
  classifyReportingPeriod,
  reportingMonthAfterPrevious,
  reportingMonthOnOrAfterApproval,
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

test('P01 chronology uses the precise approval timestamp month for first, middle and last-day approvals', () => {
  for (const approvedAt of ['2026-10-01T00:00:00.000Z', '2026-10-15T12:00:00.000Z', '2026-10-31T23:59:59.000Z']) {
    assert.equal(reportingMonthOnOrAfterApproval('2026-09', approvedAt), false);
    assert.equal(reportingMonthOnOrAfterApproval('2026-10', approvedAt), true);
    assert.equal(reportingMonthOnOrAfterApproval('2026-11', approvedAt), true);
  }
});

test('later CVRs require a strictly later month but allow quarterly and irregular gaps', () => {
  assert.equal(reportingMonthAfterPrevious('2026-09', '2026-09'), false);
  assert.equal(reportingMonthAfterPrevious('2026-08', '2026-09'), false);
  assert.equal(reportingMonthAfterPrevious('2026-12', '2026-09'), true);
  assert.equal(reportingMonthAfterPrevious('2027-05', '2026-12'), true);
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
