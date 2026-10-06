import { describe, expect, it } from 'vitest';
import {
  proposePrelimsMappings,
  PRELIMS_MAPPING_SEMANTICS_BY_TEMPLATE_KEY,
} from './prelimsMappingProposals';
import { commercialHeadCostCodeDiscovery } from '../admin/commercialHeadCostCodeDiscovery';

const STANDARD_KEYS = [
  'site_manager', 'site_supervisor', 'site_admin', 'welfare',
  'temp_electrics_standing', 'temp_electrics_connection',
  'temp_water_standing', 'temp_water_connection', 'temp_compound',
  'hoarding', 'security_manning', 'security_install', 'cleaning_ongoing',
  'cleaning_final', 'skips', 'hs_management', 'testing_inspection',
  'scaffold_inspections', 'small_plant', 'consumables', 'signage', 'ppe',
  'comms', 'temp_works_recurring', 'demobilisation',
];

const standardLines = STANDARD_KEYS.map((key, index) => ({
  id: `line-${index + 1}`,
  templateKey: `bl.prelims.v1.${key}`,
  name: key,
  enabled: true,
}));

const PILOT_CODES = [
  ['1200', 'Site Management Staff'],
  ['1210', 'Site Accommodation and Welfare'],
  ['1220', 'Temporary Services'],
  ['1230', 'Scaffolding and Safety'],
  ['1240', 'Plant and Small Tools'],
  ['1250', 'Site Security'],
  ['1260', 'Temporary Roads and Hardstandings'],
].map(([code, element]) => ({
  id: `cc-${code}`, code, element, active: true, commercialHeadId: 'head-prelims',
}));

function byKey(rows) {
  return Object.fromEntries(rows.map((row) => [row.templateKey, row]));
}

describe('semantic Prelims mapping proposals', () => {
  it('defines explicit semantic treatment for every BuildLite Standard v1 key', () => {
    expect(Object.keys(PRELIMS_MAPPING_SEMANTICS_BY_TEMPLATE_KEY).sort()).toEqual(
      standardLines.map((line) => line.templateKey).sort()
    );
  });

  it('uses the authoritative Preliminaries Head population for new proposals', () => {
    const discovery = commercialHeadCostCodeDiscovery({
      structure: {
        heads: [
          { id: 'head-prelims', name: 'Preliminaries', buildliteCategory: 'PRELIMINARIES', active: true },
          { id: 'head-sales', name: 'Sales', buildliteCategory: 'SELLING_COSTS', active: true },
        ],
        families: [], reportingGroups: [],
      },
      costCodes: [
        ...PILOT_CODES,
        { id: 'outside', code: '9000', element: 'Site Management Staff', active: true, commercialHeadId: 'head-sales' },
      ],
      category: 'PRELIMINARIES',
    });
    const result = proposePrelimsMappings([standardLines[0]], discovery.suggested);
    expect(discovery.suggested).toHaveLength(7);
    expect(result[0].proposedCostCodeKey).toBe('1200');
  });

  it('produces deterministic many-to-one proposals for the coarse seven-code chart', () => {
    const rows = byKey(proposePrelimsMappings(standardLines, PILOT_CODES));
    for (const key of ['site_manager', 'site_supervisor', 'site_admin']) {
      expect(rows[`bl.prelims.v1.${key}`].proposedCostCodeKey).toBe('1200');
    }
    expect(rows['bl.prelims.v1.welfare'].proposedCostCodeKey).toBe('1210');
    for (const key of ['temp_electrics_standing', 'temp_electrics_connection', 'temp_water_standing', 'temp_water_connection', 'comms', 'temp_works_recurring']) {
      expect(rows[`bl.prelims.v1.${key}`].proposedCostCodeKey).toBe('1220');
    }
    expect(rows['bl.prelims.v1.temp_compound'].proposedCostCodeKey).toBe('1260');
    for (const key of ['hoarding', 'security_manning', 'security_install']) {
      expect(rows[`bl.prelims.v1.${key}`].proposedCostCodeKey).toBe('1250');
    }
    expect(rows['bl.prelims.v1.hs_management'].proposedCostCodeKey).toBe('1230');
    expect(rows['bl.prelims.v1.scaffold_inspections'].proposedCostCodeKey).toBe('1230');
    expect(rows['bl.prelims.v1.small_plant'].proposedCostCodeKey).toBe('1240');
    expect(rows['bl.prelims.v1.consumables'].proposedCostCodeKey).toBe('1240');
    expect(Object.values(rows).filter((row) => row.proposalStatus.startsWith('proposed'))).toHaveLength(18);
  });

  it('keeps genuinely weak Pilot-shaped lines in owner review', () => {
    const rows = byKey(proposePrelimsMappings(standardLines, PILOT_CODES));
    for (const key of ['cleaning_ongoing', 'cleaning_final', 'skips', 'testing_inspection', 'signage', 'ppe', 'demobilisation']) {
      expect(rows[`bl.prelims.v1.${key}`]).toMatchObject({
        proposedCostCodeKey: '', proposalStatus: 'needs-review', proposalConfidence: 'review-required',
      });
    }
  });

  it('fails closed when two candidates are materially equally plausible', () => {
    const result = proposePrelimsMappings([standardLines[0]], [
      { code: 'A', element: 'Site Management Staff', active: true },
      { code: 'B', element: 'Site Management Staff', active: true },
    ]);
    expect(result[0]).toMatchObject({ proposedCostCodeKey: '', proposalStatus: 'needs-review' });
    expect(result[0].proposalBasis).toContain('More than one');
  });

  it('retains existing mappings, including an out-of-Head mapping, without rescoring', () => {
    const result = proposePrelimsMappings([
      { ...standardLines[0], costCodeKey: 'OUTSIDE' },
    ], PILOT_CODES);
    expect(result[0]).toMatchObject({
      proposedCostCodeKey: 'OUTSIDE', proposalStatus: 'existing', proposalAccepted: true,
    });
  });

  it('does not silently change disabled authority while proposing', () => {
    const result = proposePrelimsMappings([{ ...standardLines[0], enabled: false }], PILOT_CODES);
    expect(result[0].proposedEnabled).toBe(false);
  });
});
