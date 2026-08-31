const test = require('node:test');
const assert = require('node:assert/strict');
const { dateOnly } = require('../services/paymentCertificateTimetable');
const { calculatePaymentDeadlines } = require('../services/paymentRulesV1');

const rulesSnapshot = {
  rulesSchemaVersion: 1,
  paymentRules: {
    configurationState: 'complete',
    ruleType: 'uk_subcontract_payment_cycle',
    jurisdiction: 'england_wales',
    timezone: 'Europe/London',
    anchor: { type: 'contractual_valuation_date' },
    dueDate: { relativeTo: 'anchor', direction: 'after', days: 7, dayBasis: 'calendar' },
    paymentNoticeDeadline: { relativeTo: 'due_date', direction: 'after', days: 5, dayBasis: 'calendar' },
    finalDateForPayment: { relativeTo: 'due_date', direction: 'after', days: 28, dayBasis: 'calendar' },
    payLessNoticeDeadline: { relativeTo: 'final_date_for_payment', direction: 'before', days: 7, dayBasis: 'calendar' },
  },
};

test('preserves PostgreSQL DATE calendar fields during BST and GMT', () => {
  assert.equal(dateOnly(new Date(2026, 8, 1)), '2026-09-01');
  assert.equal(dateOnly(new Date(2026, 11, 1)), '2026-12-01');
  assert.equal(dateOnly('2026-09-01'), '2026-09-01');
});

test('mapped 1 September contractual date produces the authoritative 7/5/28/7 timetable', () => {
  const contractualValuationDate = dateOnly(new Date(2026, 8, 1));
  const result = calculatePaymentDeadlines({ rulesSnapshot, cycleInputs: { contractualValuationDate } });
  assert.equal(result.resolvedAnchor.value, '2026-09-01');
  assert.deepEqual(result.dates, {
    dueDate: '2026-09-08',
    paymentNoticeDeadline: '2026-09-13',
    finalDateForPayment: '2026-10-06',
    payLessNoticeDeadline: '2026-09-29',
  });
});
