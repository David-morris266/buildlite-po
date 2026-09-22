const COMMERCIAL_HEAD_CATEGORIES = Object.freeze([
  ['LAND', 'Land'],
  ['PROFESSIONAL_FEES', 'Professional Fees'],
  ['PRELIMINARIES', 'Preliminaries'],
  ['HOUSE_BUILD', 'House Build'],
  ['PLOT_WORKS', 'Plot Works'],
  ['EXTERNAL_WORKS_INFRASTRUCTURE', 'External Works & Infrastructure'],
  ['SELLING_COSTS', 'Selling Costs'],
  ['FINANCE_LEGAL', 'Finance & Legal'],
  ['CUSTOMER_COSTS', 'Customer Costs'],
].map(([key, label]) => Object.freeze({ key, label })));

const COMMERCIAL_HEAD_CATEGORY_KEYS = Object.freeze(COMMERCIAL_HEAD_CATEGORIES.map(({ key }) => key));

module.exports = { COMMERCIAL_HEAD_CATEGORIES, COMMERCIAL_HEAD_CATEGORY_KEYS };
