export const COMMERCIAL_HEADS = Object.freeze([
  'Land', 'Professional Fees', 'Preliminaries', 'House Build', 'Plot Works',
  'External Works / Infrastructure', 'Sales & Marketing', 'Finance & Legal', 'Customer Costs',
]);

export function hierarchyOf(record = {}) {
  return {
    commercialHead: record.commercialHead || '',
    commercialFamily: record.commercialFamily || '',
    reportingGroup: record.canonicalReportingGroup || '',
  };
}

export function hierarchyProposal(record = {}) {
  if (String(record.legacy?.subHeading || '').trim().toLowerCase() !== 'land') return null;
  return { commercialHead: 'Land', commercialFamily: '', reportingGroup: record.description || record.legacy?.element || 'Land' };
}
