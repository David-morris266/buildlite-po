import { describe, expect, it } from 'vitest';
import { proposePrelimsMappings, PRELIMS_MAPPING_ROLE_BY_TEMPLATE_KEY } from './prelimsMappingProposals';
import { toCostCodeSelectShape } from '../admin/costCodeMasterStore';
import { commercialHeadCostCodeDiscovery } from '../admin/commercialHeadCostCodeDiscovery';

const lines = [
  { id: '1', templateKey: 'bl.prelims.v1.site_manager', name: 'Site Manager', enabled: true },
  { id: '2', templateKey: 'bl.prelims.v1.site_supervisor', name: 'Assistant', enabled: true },
  { id: '3', templateKey: 'bl.prelims.v1.cleaning_final', name: 'Final Clean', enabled: true },
  { id: '4', templateKey: 'bl.prelims.v1.welfare', name: 'Welfare', enabled: true, costCodeKey: 'EXISTING' },
];

describe('reviewed Prelims mapping proposals', () => {
  it('proposes unique semantic matches, retains authority and leaves policy decisions for review', () => {
    const result = proposePrelimsMappings(lines, [
      { id: 'a', code: 'A', description: 'Site Management', active: true },
      { id: 'b', code: 'B', description: 'Assistant Site Manager', active: true },
      { id: 'c', code: 'C', description: 'Site Welfare', active: true },
    ]);
    expect(result[0]).toMatchObject({ proposedCostCodeKey: 'A', proposalStatus: 'proposed' });
    expect(result[1]).toMatchObject({ proposedCostCodeKey: 'B', proposalStatus: 'proposed-review' });
    expect(result[2]).toMatchObject({ proposedCostCodeKey: '', proposalStatus: 'needs-review' });
    expect(result[3]).toMatchObject({ proposedCostCodeKey: 'EXISTING', proposalStatus: 'existing' });
  });

  it('fails conservative for ambiguous, inactive and absent candidates', () => {
    const line = [lines[0]];
    expect(proposePrelimsMappings(line, [
      { code: 'A', description: 'Site Management', active: true },
      { code: 'B', description: 'Site Manager', active: true },
    ])[0].proposalStatus).toBe('needs-review');
    expect(proposePrelimsMappings(line, [
      { code: 'A', description: 'Site Management', active: false },
    ])[0].proposalStatus).toBe('needs-review');
  });

  it('uses semantic roles without customer Cost Code identities', () => {
    expect(PRELIMS_MAPPING_ROLE_BY_TEMPLATE_KEY['bl.prelims.v1.site_manager']).toBe('SITE_MANAGEMENT');
    expect(JSON.stringify(PRELIMS_MAPPING_ROLE_BY_TEMPLATE_KEY)).not.toMatch(/2000|2010|2020|2030/);
  });

  it('proposes from the production two-level Cost Code projection without Family or Reporting Group', () => {
    const standardKeys = [
      'site_manager', 'site_supervisor', 'site_admin', 'welfare',
      'temp_electrics_standing', 'temp_electrics_connection',
      'temp_water_standing', 'temp_water_connection', 'temp_compound',
      'hoarding', 'security_manning', 'security_install', 'cleaning_ongoing',
      'cleaning_final', 'skips', 'hs_management', 'testing_inspection',
      'scaffold_inspections', 'small_plant', 'consumables', 'signage', 'ppe',
      'comms', 'temp_works_recurring', 'demobilisation',
    ];
    const standardLines = standardKeys.map((key, index) => ({
      id: `line-${index + 1}`,
      templateKey: `bl.prelims.v1.${key}`,
      name: key,
      enabled: true,
    }));
    const projected = [
      ['cc-a', '2000', 'Site Management'],
      ['cc-b', '2010', 'Assistant Site Manager'],
      ['cc-c', '2020', 'Site Welfare'],
      ['cc-d', '2030', 'Temporary Services'],
    ].map(([id, code, description]) => toCostCodeSelectShape({
      id, code, description, active: true, commercialHeadId: 'head-prelims',
      commercialFamilyId: null, reportingGroupId: null,
    }));
    expect(projected[0].description).toBeUndefined();
    expect(projected[0].element).toBe('Site Management');
    const discovery = commercialHeadCostCodeDiscovery({
      structure: {
        heads: [{ id: 'head-prelims', name: 'Preliminaries', buildliteCategory: 'PRELIMINARIES', active: true }],
        families: [], reportingGroups: [],
      },
      costCodes: projected,
      category: 'PRELIMINARIES',
    });
    const proposals = proposePrelimsMappings(standardLines, discovery.suggested);
    const byKey = Object.fromEntries(proposals.map((row) => [row.templateKey, row]));
    expect(proposals.filter((row) => row.proposalStatus.startsWith('proposed'))).toHaveLength(11);
    expect(byKey['bl.prelims.v1.site_manager'].proposedCostCodeKey).toBe('2000');
    expect(byKey['bl.prelims.v1.site_supervisor'].proposedCostCodeKey).toBe('2010');
    expect(byKey['bl.prelims.v1.site_admin'].proposedCostCodeKey).toBe('2000');
    expect(byKey['bl.prelims.v1.welfare'].proposedCostCodeKey).toBe('2020');
    expect(byKey['bl.prelims.v1.temp_electrics_standing'].proposedCostCodeKey).toBe('2030');
    expect(byKey['bl.prelims.v1.temp_compound'].proposedCostCodeKey).toBe('2020');
    expect(byKey['bl.prelims.v1.comms'].proposedCostCodeKey).toBe('2030');
    expect(byKey['bl.prelims.v1.cleaning_final'].proposalStatus).toBe('needs-review');
    expect(byKey['bl.prelims.v1.scaffold_inspections'].proposalStatus).toBe('needs-review');

    const ambiguous = proposePrelimsMappings([standardLines[0]], [
      projected[0],
      toCostCodeSelectShape({
        id: 'cc-e', code: '2040', description: 'Site Manager', active: true,
        commercialHeadId: 'head-prelims', commercialFamilyId: null, reportingGroupId: null,
      }),
    ]);
    expect(ambiguous[0]).toMatchObject({ proposedCostCodeKey: '', proposalStatus: 'needs-review' });
  });
});
