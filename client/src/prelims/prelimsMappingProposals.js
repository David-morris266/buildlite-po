const CONCEPTS = Object.freeze({
  SITE_MANAGEMENT: ['site management staff', 'site management', 'site manager'],
  SITE_WELFARE: ['site accommodation and welfare', 'site accommodation', 'site welfare', 'welfare'],
  TEMPORARY_SERVICES: ['temporary services', 'temporary utilities'],
  COMPOUND_HARDSTANDING: ['temporary roads and hardstandings', 'temporary hardstanding', 'hardstanding', 'temporary compound'],
  SITE_SECURITY: ['site security', 'security', 'perimeter protection'],
  SITE_CLEANING: ['site cleaning', 'cleaning'],
  SITE_WASTE: ['site waste', 'waste', 'skips'],
  SITE_SAFETY: ['scaffolding and safety', 'health and safety', 'site safety'],
  TESTING_INSPECTION: ['testing and inspection', 'testing', 'inspection'],
  SCAFFOLD_SAFETY: ['scaffolding and safety', 'scaffolding', 'scaffold'],
  SITE_PLANT: ['plant and small tools', 'small tools', 'site plant'],
  SITE_CONSUMABLES: ['plant and small tools', 'small tools', 'site consumables'],
  SITE_SIGNAGE: ['site signage', 'signage'],
  SITE_PPE: ['personal protective equipment', 'ppe'],
  SITE_COMMUNICATIONS: ['temporary services', 'site communications', 'communications'],
  TEMPORARY_WORKS: ['temporary services', 'temporary works'],
  DEMOBILISATION: ['demobilisation', 'site demobilisation', 'compound removal'],
});

const SEMANTICS_BY_TEMPLATE_KEY = Object.freeze({
  'bl.prelims.v1.site_manager': { concept: 'SITE_MANAGEMENT' },
  'bl.prelims.v1.site_supervisor': { concept: 'SITE_MANAGEMENT', reviewGuidance: 'Confirm the Development needs separate assistant or supervisor resource; the line may be disabled on a small site.' },
  'bl.prelims.v1.site_admin': { concept: 'SITE_MANAGEMENT' },
  'bl.prelims.v1.welfare': { concept: 'SITE_WELFARE' },
  'bl.prelims.v1.temp_electrics_standing': { concept: 'TEMPORARY_SERVICES' },
  'bl.prelims.v1.temp_electrics_connection': { concept: 'TEMPORARY_SERVICES' },
  'bl.prelims.v1.temp_water_standing': { concept: 'TEMPORARY_SERVICES' },
  'bl.prelims.v1.temp_water_connection': { concept: 'TEMPORARY_SERVICES' },
  'bl.prelims.v1.temp_compound': { concept: 'COMPOUND_HARDSTANDING' },
  'bl.prelims.v1.hoarding': { concept: 'SITE_SECURITY' },
  'bl.prelims.v1.security_manning': { concept: 'SITE_SECURITY' },
  'bl.prelims.v1.security_install': { concept: 'SITE_SECURITY', reviewGuidance: 'Confirm whether installation is separately procured or included with monitoring.' },
  'bl.prelims.v1.cleaning_ongoing': { concept: 'SITE_CLEANING' },
  'bl.prelims.v1.cleaning_final': { concept: 'SITE_CLEANING', reviewGuidance: 'Confirm whether final clean is a site Prelim or a plot-finishing package cost.' },
  'bl.prelims.v1.skips': { concept: 'SITE_WASTE' },
  'bl.prelims.v1.hs_management': { concept: 'SITE_SAFETY', reviewGuidance: 'A site provision may be Prelims; a professional CDM consultant may belong under Professional Fees.' },
  'bl.prelims.v1.testing_inspection': { concept: 'TESTING_INSPECTION' },
  'bl.prelims.v1.scaffold_inspections': { concept: 'SCAFFOLD_SAFETY', reviewGuidance: 'Confirm whether statutory inspections are separately procured or included in the scaffold package.' },
  'bl.prelims.v1.small_plant': { concept: 'SITE_PLANT' },
  'bl.prelims.v1.consumables': { concept: 'SITE_CONSUMABLES' },
  'bl.prelims.v1.signage': { concept: 'SITE_SIGNAGE' },
  'bl.prelims.v1.ppe': { concept: 'SITE_PPE' },
  'bl.prelims.v1.comms': { concept: 'SITE_COMMUNICATIONS' },
  'bl.prelims.v1.temp_works_recurring': { concept: 'TEMPORARY_WORKS', reviewGuidance: 'Use only for genuinely shared site provision; package-specific temporary works stay with the trade.' },
  'bl.prelims.v1.demobilisation': { concept: 'DEMOBILISATION' },
});

function normalized(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function candidateEvidence(code) {
  return [code.description, code.element, code.commercialFamily, code.subHeading, code.reportingGroup]
    .map(normalized)
    .filter(Boolean);
}

function phraseScore(phrase, evidence) {
  const target = normalized(phrase);
  if (!target) return 0;
  if (evidence.some((value) => value === target)) return 100;
  if (evidence.some((value) => value.includes(target))) return target.includes(' ') ? 90 : 75;
  const tokens = target.split(' ').filter((token) => token.length >= 4 && token !== 'site');
  if (tokens.length >= 2 && evidence.some((value) => tokens.every((token) => value.split(' ').includes(token)))) return 80;
  return 0;
}

function scoreCandidate(semantic, code) {
  const evidence = candidateEvidence(code);
  const aliases = CONCEPTS[semantic.concept] || [];
  return Math.max(0, ...aliases.map((phrase) => phraseScore(phrase, evidence)));
}

function candidateLabel(code) {
  const description = code.description || code.element || '';
  return [code.code, description].filter(Boolean).join(' — ');
}

function rankedCandidates(semantic, costCodes) {
  return (costCodes || [])
    .filter((code) => code.active !== false)
    .map((code) => ({ code, score: scoreCandidate(semantic, code) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.code.code).localeCompare(String(b.code.code)));
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
        proposalConfidence: 'existing',
        proposalAccepted: true,
        proposalBasis: 'Existing company mapping retained. Change it only by explicit review.',
      };
    }

    const semantic = SEMANTICS_BY_TEMPLATE_KEY[line.templateKey];
    const ranked = semantic ? rankedCandidates(semantic, suggestedCostCodes) : [];
    const best = ranked[0] || null;
    const next = ranked[1] || null;
    const unambiguous = best && (!next || next.score < best.score);
    const confident = unambiguous && best.score >= 75;

    if (confident) {
      const conceptLabel = semantic.concept.replaceAll('_', ' ').toLowerCase();
      return {
        ...line,
        proposedCostCodeKey: best.code.code,
        proposedEnabled: line.enabled !== false,
        proposalStatus: semantic.reviewGuidance ? 'proposed-review' : 'proposed',
        proposalConfidence: best.score >= 90 ? 'high' : 'medium',
        proposalAccepted: false,
        proposalBasis: semantic.reviewGuidance || `Matched ${conceptLabel} concept to ${candidateLabel(best.code)}.`,
      };
    }

    return {
      ...line,
      proposedCostCodeKey: '',
      suggestedCostCodeKey: unambiguous && best ? best.code.code : '',
      proposedEnabled: line.enabled !== false,
      proposalStatus: 'needs-review',
      proposalConfidence: 'review-required',
      proposalAccepted: false,
      proposalBasis: semantic?.reviewGuidance || (best && next && best.score === next.score
        ? 'More than one eligible Company Cost Code is materially plausible.'
        : line.description || 'BuildLite cannot determine a defensible Company Cost Code.'),
    };
  });
}

export const PRELIMS_MAPPING_SEMANTICS_BY_TEMPLATE_KEY = SEMANTICS_BY_TEMPLATE_KEY;
export const PRELIMS_MAPPING_ROLE_BY_TEMPLATE_KEY = Object.freeze(
  Object.fromEntries(Object.entries(SEMANTICS_BY_TEMPLATE_KEY).map(([key, value]) => [key, value.concept]))
);
