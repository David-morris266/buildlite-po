export const anchorOptions=[
  ['application_received_date','application received date'],['application_valuation_date','application valuation date'],
  ['certificate_date','certificate date'],['contractual_valuation_date','contractual valuation date'],
];
export const defaultPaymentRules={configurationState:'incomplete',ruleType:'uk_subcontract_payment_cycle',jurisdiction:'england_wales',timezone:'Europe/London',anchor:{type:'contractual_valuation_date'},dueDate:{relativeTo:'anchor',direction:'after',days:null,dayBasis:'calendar'},paymentNoticeDeadline:{relativeTo:'due_date',direction:'after',days:null,dayBasis:'calendar'},finalDateForPayment:{relativeTo:'due_date',direction:'after',days:null,dayBasis:'calendar'},payLessNoticeDeadline:{relativeTo:'final_date_for_payment',direction:'before',days:null,dayBasis:'calendar'}};
const labels={anchor:'anchor',due_date:'due date',final_date_for_payment:'final date for payment'};
export function normalisePaymentRules(value={}){return {...defaultPaymentRules,...value,anchor:{...defaultPaymentRules.anchor,...value.anchor},dueDate:{...defaultPaymentRules.dueDate,...value.dueDate},paymentNoticeDeadline:{...defaultPaymentRules.paymentNoticeDeadline,...value.paymentNoticeDeadline},finalDateForPayment:{...defaultPaymentRules.finalDateForPayment,...value.finalDateForPayment},payLessNoticeDeadline:{...defaultPaymentRules.payLessNoticeDeadline,...value.payLessNoticeDeadline}};}
export function paymentRulesPreview(rules){const anchor=anchorOptions.find(([key])=>key===rules.anchor.type)?.[1]||'selected anchor';const days=value=>Number.isInteger(value)?value:'—';return [
  `Due date: ${days(rules.dueDate.days)} calendar days after ${anchor}`,
  `Payment Notice deadline: ${days(rules.paymentNoticeDeadline.days)} calendar days after ${labels[rules.paymentNoticeDeadline.relativeTo]}`,
  `Final date for payment: ${days(rules.finalDateForPayment.days)} calendar days after due date`,
  `Pay Less Notice deadline: ${days(rules.payLessNoticeDeadline.days)} calendar days before final date for payment`,
];}
