import {describe,expect,it} from 'vitest';
import {defaultPaymentRules,normalisePaymentRules,paymentRulesPreview} from './paymentRulesV1';

describe('payment rules V1 presentation',()=>{
  it('normalises an incomplete Draft into editable controls without requiring JSON',()=>{const rules=normalisePaymentRules({configurationState:'incomplete'});expect(rules.configurationState).toBe('incomplete');expect(rules.jurisdiction).toBe('england_wales');expect(rules.timezone).toBe('Europe/London');expect(rules.anchor.type).toBe('contractual_valuation_date');});
  it('renders the configured dependencies in plain English',()=>{const rules={...defaultPaymentRules,configurationState:'complete',dueDate:{...defaultPaymentRules.dueDate,days:7},paymentNoticeDeadline:{...defaultPaymentRules.paymentNoticeDeadline,days:5},finalDateForPayment:{...defaultPaymentRules.finalDateForPayment,days:28},payLessNoticeDeadline:{...defaultPaymentRules.payLessNoticeDeadline,days:7}};expect(paymentRulesPreview(rules)).toEqual(['Due date: 7 calendar days after contractual valuation date','Payment Notice deadline: 5 calendar days after due date','Final date for payment: 28 calendar days after due date','Pay Less Notice deadline: 7 calendar days before final date for payment']);});
});
