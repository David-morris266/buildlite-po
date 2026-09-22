export const PLOT_TENURE_CODES = [
  'OPEN_MARKET','AFFORDABLE_RENT','SHARED_OWNERSHIP','FIRST_HOMES',
  'ADDITIONALITY','DISCOUNT_MARKET_SALE','OTHER','UNREVIEWED',
];
export const PLOT_TENURE_OPTIONS = [
  ['UNREVIEWED','Unreviewed'],['OPEN_MARKET','Open Market / Private'],
  ['AFFORDABLE_RENT','Affordable Rent'],['SHARED_OWNERSHIP','Shared Ownership'],
  ['FIRST_HOMES','First Homes'],['ADDITIONALITY','Additionality'],
  ['DISCOUNT_MARKET_SALE','Discount Market Sale'],['OTHER','Other'],
].map(([value,label])=>({value,label}));
const ALIASES={
  'open market':'OPEN_MARKET',private:'OPEN_MARKET',market:'OPEN_MARKET',
  'affordable rent':'AFFORDABLE_RENT','social rent':'AFFORDABLE_RENT','affordable housing':'AFFORDABLE_RENT',
  'shared ownership':'SHARED_OWNERSHIP','social shared':'SHARED_OWNERSHIP',
  'first homes':'FIRST_HOMES',additionality:'ADDITIONALITY',
  'discount market sale':'DISCOUNT_MARKET_SALE',dms:'DISCOUNT_MARKET_SALE',other:'OTHER',
};
export function normalizePlotTenureCode(value){const code=String(value||'').trim().toUpperCase();return PLOT_TENURE_CODES.includes(code)?code:'UNREVIEWED';}
export function classifyImportedTenure(value){return ALIASES[String(value||'').trim().toLowerCase()]||'UNREVIEWED';}
