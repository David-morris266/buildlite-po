/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  PRELIMS_ADOPTION_DRIFT_STATES,
  PRELIMS_ADOPTION_FLAG_KEYS,
  PRELIMS_ADOPTION_METADATA_KEY,
  buildPrelimsAdoptionMetadata,
  buildPrelimsAdoptionPreview,
  buildProposalFingerprint,
  comparePrelimsAdoptionCandidate,
  enrichPrelimsItemsForAdoption,
  resolveAdoptionDriftState,
} from './prelimsAdoptionCompare';

const DEV_ID = 'dev-1785599776666-zck5pl';
const PERIOD_KEY = 'P04';
const REPORTING_MONTH = '2026-08';

const TEST_SITE_1_PROGRAMME = {
  siteStart: '2026-09-01',
  firstCompletion: null,
  finalCompletion: '2029-10-01',
};

const TEST_SITE_1_PRELIMS = [
  {
    id: '3e9402bf-3093-4228-be69-0d163e5b5bda',
    costCodeKey: '5231',
    name: 'BL-033D.1 LUMP SUM UAT',
    forecastDriver: 'LUMP_SUM',
    lumpSumAmount: 20000,
    status: 'active',
    version: 6,
  },
  {
    id: 'da5b67be-8432-454e-b6a5-37e163078f1c',
    costCodeKey: '5231',
    name: 'BL-033D.1 TIME UAT',
    forecastDriver: 'TIME',
    monthlyRate: 1000,
    startBasis: 'SITE_START',
    endBasis: 'FINAL_COMPLETION',
    status: 'active',
    version: 1,
  },
  {
    id: 'da6668b7-329c-4cab-a0aa-1233184d79cb',
    costCodeKey: '5231',
    name: 'BL-033D.1 UNRESOLVED UAT',
    forecastDriver: 'TIME',
    monthlyRate: 1000,
    startBasis: 'FIRST_COMPLETION',
    endBasis: 'FINAL_COMPLETION',
    status: 'active',
    version: 1,
  },
  {
    id: 'c67ee4db-7f7f-4813-8cbf-d289781c2efa',
    costCodeKey: 'UAT-CC-001',
    name: 'BL-033D.x.2 CUSTOM UAT',
    forecastDriver: 'LUMP_SUM',
    lumpSumAmount: 1000,
    status: 'active',
    version: 1,
  },
];

function enrichedTestSiteLines() {
  return enrichPrelimsItemsForAdoption(TEST_SITE_1_PRELIMS, {
    programme: TEST_SITE_1_PROGRAMME,
    reportingMonth: REPORTING_MONTH,
  });
}

function preview5231(overrides = {}) {
  const enriched = enrichedTestSiteLines();
  return buildPrelimsAdoptionPreview({
    developmentId: DEV_ID,
    periodKey: PERIOD_KEY,
    reportingMonth: REPORTING_MONTH,
    prelimsItems: TEST_SITE_1_PRELIMS,
    programme: TEST_SITE_1_PROGRAMME,
    cvrRows: [
      {
        costCodeKey: '5231',
        systemForecast: 50280,
        commercialAdjustment: 520,
        finalForecast: 50800,
        manualAccrual: 120,
        ...overrides.cvr5231,
      },
    ],
    classifications: [{ costCodeKey: '5231', semanticGroup: 'PRELIMS' }],
    displayMetadataByCostCode: overrides.displayMetadataByCostCode || {},
  });
}

describe('BL-033D.x.4A Prelims adoption compare engine', () => {
  it('matches Test Site 1 5231 worked example', () => {
    const preview = preview5231();
    const row = preview.candidates.find((item) => item.costCodeKey === '5231');

    expect(row.systemForecast).toBe(50280);
    expect(row.currentAdjustment).toBe(520);
    expect(row.currentFinalForecast).toBe(50800);
    expect(row.manualAccrual).toBe(120);
    expect(row.resolvedPrelimsTotal).toBe(58000);
    expect(row.unresolvedCount).toBe(1);
    expect(row.proposedAdjustment).toBe(7720);
    expect(row.proposedFinalForecast).toBe(58000);
    expect(row.deltaFinal).toBe(7200);
    expect(row.flags[PRELIMS_ADOPTION_FLAG_KEYS.UNRESOLVED_EXPOSURE]).toBe(true);
    expect(row.flags[PRELIMS_ADOPTION_FLAG_KEYS.PROPOSAL_BELOW_SYSTEM]).toBe(false);
    expect(row.cannotAdopt).toBe(false);
    expect(row.excludedUnresolvedLineIds).toContain('da6668b7-329c-4cab-a0aa-1233184d79cb');
  });

  it('warns when proposal is below system forecast', () => {
    const enriched = enrichedTestSiteLines().filter((line) => line.costCodeKey === '5231');
    const row = comparePrelimsAdoptionCandidate({
      costCodeKey: '5231',
      prelimsBucket: {
        costCodeKey: '5231',
        resolvedPrelimsTotal: 58000,
        unresolvedCount: 0,
        unresolvedLineIds: [],
        sourceLineIds: ['a', 'b'],
        excludedUnresolvedLineIds: [],
        lineCount: 2,
      },
      cvrRow: {
        costCodeKey: '5231',
        systemForecast: 70000,
        commercialAdjustment: 0,
        finalForecast: 70000,
      },
      enrichedLines: enriched.slice(0, 2),
      developmentId: DEV_ID,
      periodKey: PERIOD_KEY,
      reportingMonth: REPORTING_MONTH,
    });

    expect(row.proposedAdjustment).toBe(-12000);
    expect(row.proposedFinalForecast).toBe(58000);
    expect(row.flags[PRELIMS_ADOPTION_FLAG_KEYS.PROPOSAL_BELOW_SYSTEM]).toBe(true);
  });

  it('aggregates multiple resolved lines on the same cost code', () => {
    const preview = preview5231();
    const row = preview.candidates.find((item) => item.costCodeKey === '5231');
    expect(row.sourceLineIds).toEqual([
      '3e9402bf-3093-4228-be69-0d163e5b5bda',
      'da5b67be-8432-454e-b6a5-37e163078f1c',
    ]);
  });

  it('marks UAT-CC-001 as not on CVR and cannot adopt', () => {
    const preview = preview5231();
    const row = preview.candidates.find((item) => item.costCodeKey === 'UAT-CC-001');

    expect(row.resolvedPrelimsTotal).toBe(1000);
    expect(row.flags[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW]).toBe(true);
    expect(row.cannotAdopt).toBe(true);
    expect(row.proposedAdjustment).toBe(null);
  });

  it('builds a deterministic fingerprint and detects proposal changes', () => {
    const enriched = enrichedTestSiteLines().filter((line) => line.costCodeKey === '5231');
    const base = buildProposalFingerprint({
      developmentId: DEV_ID,
      periodKey: PERIOD_KEY,
      reportingMonth: REPORTING_MONTH,
      lines: enriched,
    });
    const same = buildProposalFingerprint({
      developmentId: DEV_ID,
      periodKey: PERIOD_KEY,
      reportingMonth: REPORTING_MONTH,
      lines: enriched,
    });
    const changed = buildProposalFingerprint({
      developmentId: DEV_ID,
      periodKey: PERIOD_KEY,
      reportingMonth: REPORTING_MONTH,
      lines: enriched.map((line) =>
        line.id === 'da5b67be-8432-454e-b6a5-37e163078f1c'
          ? { ...line, monthlyRate: 1100 }
          : line
      ),
    });

    expect(same).toBe(base);
    expect(changed).not.toBe(base);

    const offsetShifted = buildProposalFingerprint({
      developmentId: DEV_ID,
      periodKey: PERIOD_KEY,
      reportingMonth: REPORTING_MONTH,
      lines: enriched.map((line) =>
        line.id === 'da5b67be-8432-454e-b6a5-37e163078f1c'
          ? { ...line, startOffsetMonths: 3, endOffsetMonths: 3 }
          : line
      ),
    });
    expect(offsetShifted).not.toBe(base);
  });

  it('reports up to date when fingerprint and adopted final match', () => {
    const enriched = enrichedTestSiteLines().filter((line) => line.costCodeKey === '5231');
    const fingerprint = buildProposalFingerprint({
      developmentId: DEV_ID,
      periodKey: PERIOD_KEY,
      reportingMonth: REPORTING_MONTH,
      lines: enriched,
    });
    const metadata = buildPrelimsAdoptionMetadata({
      adoptedTargetFinal: 58000,
      adoptedAdjustment: 7720,
      systemForecastAtAdoption: 50280,
      previousFinalForecast: 50800,
      previousAdjustment: 520,
      proposalFingerprint: fingerprint,
      sourceLineIds: ['a', 'b'],
      excludedUnresolvedLineIds: ['da6668b7-329c-4cab-a0aa-1233184d79cb'],
      reportingMonth: REPORTING_MONTH,
      periodKey: PERIOD_KEY,
      adoptedAt: '2026-08-23T10:00:00.000Z',
      adoptedBy: 'Commercial Manager',
    });

    const drift = resolveAdoptionDriftState({
      metadata,
      currentFingerprint: fingerprint,
      currentFinalForecast: 58000,
      currentAdjustment: 7720,
      systemForecast: 50280,
    });

    expect(drift.primary).toBe(PRELIMS_ADOPTION_DRIFT_STATES.UP_TO_DATE);
    expect(drift.isUpToDate).toBe(true);
  });

  it('detects proposal changed since adoption', () => {
    const enriched = enrichedTestSiteLines().filter((line) => line.costCodeKey === '5231');
    const oldFingerprint = buildProposalFingerprint({
      developmentId: DEV_ID,
      periodKey: PERIOD_KEY,
      reportingMonth: REPORTING_MONTH,
      lines: enriched,
    });
    const newFingerprint = buildProposalFingerprint({
      developmentId: DEV_ID,
      periodKey: PERIOD_KEY,
      reportingMonth: REPORTING_MONTH,
      lines: enriched.map((line) =>
        line.id === 'da5b67be-8432-454e-b6a5-37e163078f1c'
          ? { ...line, monthlyRate: 1100, calculation: { ...line.calculation, totalForecast: 41800 } }
          : line
      ),
    });

    const drift = resolveAdoptionDriftState({
      metadata: {
        adoptedTargetFinal: 58000,
        adoptedAdjustment: 7720,
        proposalFingerprint: oldFingerprint,
      },
      currentFingerprint: newFingerprint,
      currentFinalForecast: 58000,
      currentAdjustment: 7720,
      systemForecast: 50280,
    });

    expect(drift.primary).toBe(PRELIMS_ADOPTION_DRIFT_STATES.PROPOSAL_CHANGED);
    expect(drift.flags).toContain(PRELIMS_ADOPTION_DRIFT_STATES.PROPOSAL_CHANGED);
  });

  it('detects CVR drift when system forecast moves but adoption adjustment remains', () => {
    const fingerprint = buildProposalFingerprint({
      developmentId: DEV_ID,
      periodKey: PERIOD_KEY,
      reportingMonth: REPORTING_MONTH,
      lines: enrichedTestSiteLines().filter((line) => line.costCodeKey === '5231'),
    });

    const drift = resolveAdoptionDriftState({
      metadata: {
        adoptedTargetFinal: 58000,
        adoptedAdjustment: 7720,
        systemForecastAtAdoption: 50280,
        proposalFingerprint: fingerprint,
      },
      currentFingerprint: fingerprint,
      currentFinalForecast: 63000,
      currentAdjustment: 7720,
      systemForecast: 55280,
    });

    expect(drift.primary).toBe(PRELIMS_ADOPTION_DRIFT_STATES.CVR_DRIFT);
    expect(drift.flags).toContain(PRELIMS_ADOPTION_DRIFT_STATES.CVR_DRIFT);
  });

  it('detects manual adjustment superseding adoption metadata', () => {
    const fingerprint = buildProposalFingerprint({
      developmentId: DEV_ID,
      periodKey: PERIOD_KEY,
      reportingMonth: REPORTING_MONTH,
      lines: enrichedTestSiteLines().filter((line) => line.costCodeKey === '5231'),
    });

    const drift = resolveAdoptionDriftState({
      metadata: {
        adoptedTargetFinal: 58000,
        adoptedAdjustment: 7720,
        proposalFingerprint: fingerprint,
      },
      currentFingerprint: fingerprint,
      currentFinalForecast: 59000,
      currentAdjustment: 8720,
      systemForecast: 50280,
    });

    expect(drift.primary).toBe(PRELIMS_ADOPTION_DRIFT_STATES.ADOPTION_SUPERSEDED);
  });

  it('exposes metadata contract key for display_metadata', () => {
    expect(PRELIMS_ADOPTION_METADATA_KEY).toBe('prelimsAdoption');
    const metadata = buildPrelimsAdoptionMetadata({
      adoptedTargetFinal: 58000,
      adoptedAdjustment: 7720,
      systemForecastAtAdoption: 50280,
      previousFinalForecast: 50800,
      previousAdjustment: 520,
      proposalFingerprint: 'bl033dx4a-deadbeef',
      sourceLineIds: ['a'],
      excludedUnresolvedLineIds: ['b'],
      reportingMonth: REPORTING_MONTH,
      periodKey: PERIOD_KEY,
      adoptedAt: '2026-08-23T10:00:00.000Z',
      adoptedBy: 'Commercial Manager',
    });

    expect(metadata).toMatchObject({
      adoptedTargetFinal: 58000,
      adoptedAdjustment: 7720,
      systemForecastAtAdoption: 50280,
      previousFinalForecast: 50800,
      previousAdjustment: 520,
      proposalFingerprint: 'bl033dx4a-deadbeef',
      sourceLineIds: ['a'],
      excludedUnresolvedLineIds: ['b'],
      reportingMonth: '2026-08',
      periodKey: 'P04',
      adoptedBy: 'Commercial Manager',
      superseded: false,
    });
  });
});
