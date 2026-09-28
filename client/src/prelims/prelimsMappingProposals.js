const ROLE_BY_TEMPLATE_KEY = Object.freeze({
  'bl.prelims.v1.site_manager': 'SITE_MANAGEMENT',
  'bl.prelims.v1.site_supervisor': 'ASSISTANT_SITE_MANAGEMENT',
  'bl.prelims.v1.site_admin': 'SITE_MANAGEMENT',
  'bl.prelims.v1.welfare': 'SITE_WELFARE',
  'bl.prelims.v1.temp_electrics_standing': 'TEMPORARY_SERVICES',
  'bl.prelims.v1.temp_electrics_connection': 'TEMPORARY_SERVICES',
  'bl.prelims.v1.temp_water_standing': 'TEMPORARY_SERVICES',
  'bl.prelims.v1.temp_water_connection': 'TEMPORARY_SERVICES',
  'bl.prelims.v1.temp_compound': 'SITE_WELFARE',
  'bl.prelims.v1.comms': 'TEMPORARY_SERVICES',
  'bl.prelims.v1.temp_works_recurring': 'TEMPORARY_SERVICES',
});

const ROLE_LABELS = Object.freeze({
  SITE_MANAGEMENT: ['site management', 'site manager'],
  ASSISTANT_SITE_MANAGEMENT: ['assistant site manager', 'site supervisor'],
  SITE_WELFARE: ['site welfare', 'welfare'],
  TEMPORARY_SERVICES: ['temporary services', 'temporary service'],
});

const OWNER_REVIEW_GUIDANCE = Object.freeze({
  'bl.prelims.v1.site_supervisor': 'Confirm the Development needs separate assistant or supervisor resource; the line may be disabled on a small site.',
  'bl.prelims.v1.security_install': 'Confirm whether installation is separately procured or included with monitoring.',
  'bl.prelims.v1.cleaning_final': 'Confirm whether final clean is a site Prelim or a plot-finishing package cost.',
  'bl.prelims.v1.hs_management': 'A site provision may be Prelims; a professional CDM consultant may belong under Professional Fees.',
  'bl.prelims.v1.scaffold_inspections': 'Confirm whether statutory inspections are separately procured or included in the scaffold package.',
  'bl.prelims.v1.temp_works_recurring': 'Use only for genuinely shared site provision; package-specific temporary works stay with the trade.',
});

function normalized(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function roleCandidates(role, costCodes) {
  const labels = ROLE_LABELS[role] || [];
  return (costCodes || []).filter((code) => {
    if (code.active === false) return false;
    const evidence = [
      code.description,
      code.element,
      code.commercialFamily,
      code.subHeading,
      code.reportingGroup,
    ].map(normalized).filter(Boolean);
    return evidence.some((value) => labels.includes(value));
  });
}

export function proposePrelimsMappings(lines = [], suggestedCostCodes = []) {
  return lines.map((line) => {
    const existing = String(line.costCodeKey || '').trim();
    if (existing) {
      return {
        ...line,
        proposedCostCodeKey: existing,
        proposedEnabled: line.enabled !== false,
        proposalStatus: 'existing',
        proposalBasis: 'Existing company mapping retained. Change it only by explicit review.',
      };
    }
    const role = ROLE_BY_TEMPLATE_KEY[line.templateKey];
    const matches = role ? roleCandidates(role, suggestedCostCodes) : [];
    const guidance = OWNER_REVIEW_GUIDANCE[line.templateKey];
    if (matches.length === 1) {
      return {
        ...line,
        proposedCostCodeKey: matches[0].code,
        proposedEnabled: line.enabled !== false,
        proposalStatus: guidance ? 'proposed-review' : 'proposed',
        proposalBasis: guidance || `Unique active Preliminaries Cost Code matching BuildLite semantic role ${role.replaceAll('_', ' ').toLowerCase()}.`,
      };
    }
    return {
      ...line,
      proposedCostCodeKey: '',
      proposedEnabled: line.enabled !== false,
      proposalStatus: 'needs-review',
      proposalBasis: guidance || (role && matches.length > 1
        ? 'More than one eligible Company Cost Code matches this semantic role.'
        : line.description || 'BuildLite cannot determine a unique defensible Company Cost Code.'),
    };
  });
}

export const PRELIMS_MAPPING_ROLE_BY_TEMPLATE_KEY = ROLE_BY_TEMPLATE_KEY;
