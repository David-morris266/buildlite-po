/**
 * BL-016F — Demo cost codes (explicit opt-in only; not customer data).
 */

export const DEMO_COST_CODES = [
  { code: '1100', description: 'Land purchase', commercialHead: 'Land', commercialFamily: 'Acquisition', trade: 'Land Purchase', defaultOrderType: 'S' },
  { code: '1110', description: 'Stamp duty land tax', commercialHead: 'Land', commercialFamily: 'Acquisition', trade: 'Land Purchase', defaultOrderType: 'S' },
  { code: '1200', description: 'Planning fees', commercialHead: 'Professional Fees', commercialFamily: 'Planning', trade: 'Planning', defaultOrderType: 'S' },
  { code: '1300', description: 'Site establishment', commercialHead: 'Preliminaries', commercialFamily: 'Site Establishment', trade: 'General', defaultOrderType: 'S' },
  { code: '2100', description: 'Groundworks', commercialHead: 'House Build', commercialFamily: 'Groundworks', trade: 'Groundworks', defaultOrderType: 'S' },
  { code: '2200', description: 'Foundations', commercialHead: 'House Build', commercialFamily: 'Foundations', trade: 'Foundations', defaultOrderType: 'S' },
  { code: '2300', description: 'Brickwork', commercialHead: 'House Build', commercialFamily: 'Superstructure', trade: 'Brickwork', defaultOrderType: 'S' },
  { code: '2400', description: 'Roof coverings', commercialHead: 'House Build', commercialFamily: 'Roofing', trade: 'Roof', defaultOrderType: 'S' },
  { code: '2500', description: 'Windows and doors', commercialHead: 'House Build', commercialFamily: 'Windows', trade: 'Windows', defaultOrderType: 'S' },
  { code: '2600', description: 'Internal finishes', commercialHead: 'House Build', commercialFamily: 'Internal Finishes', trade: 'Interiors', defaultOrderType: 'S' },
  { code: '2700', description: 'M&E installations', commercialHead: 'House Build', commercialFamily: 'M&E', trade: 'M&E', defaultOrderType: 'S' },
  { code: '3100', description: 'External works', commercialHead: 'External Works', commercialFamily: 'External Works', trade: 'External Works', defaultOrderType: 'S' },
  { code: '4100', description: 'Sales & marketing', commercialHead: 'Sales & Marketing', commercialFamily: 'Sales', trade: 'Sales', defaultOrderType: 'S' },
  { code: '5100', description: 'Customer care', commercialHead: 'Customer Costs', commercialFamily: 'Customer Care', trade: 'Customer Care', defaultOrderType: 'S' },
];

export function getDemoCostCodeCount() {
  return DEMO_COST_CODES.length;
}
