import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { getCommercialStructure } from '../admin/commercialStructureStore';
import { listCostCodeMasterRecords } from '../admin/costCodeMasterStore';
import {
  getCompletedSectionCount,
  getFirstIncompleteStep,
  getResumeStep,
  isSectionComplete,
  markSectionComplete,
  markSetupStarted,
} from './setupProgressStore';
import {
  loadOnboardingDraft,
  saveOnboardingDraft,
  validateCostCodesStep,
} from './onboardingDraft';
import {
  commitCommercialDefaultsSection,
  commitCompanySection,
  commitCostCodesSection,
  installDemoCostCodes,
} from './setupCommit';

const SAMPLE_COMPANY = {
  companyName: 'BuildLite Homes Ltd',
  tradingName: 'BuildLite',
  companyNumber: '12345678',
  vatNumber: 'GB123',
  addressLine1: '1 High Street',
  addressLine2: '',
  town: 'London',
  postcode: 'SW1A 1AA',
  financialYearStart: '04-01',
  currency: 'GBP',
};

const SAMPLE_COMMERCIAL = {
  defaultRetentionPercent: 5,
  vatRate: 20,
  defaultForecastBehaviour: 'Committed',
  numberingPrefixes: {
    development: 'DEV-',
    purchaseOrder: 'PO-',
    paymentCertificate: 'PC-',
    cvr: 'CVR-',
    variationOrder: 'VO-',
    salesPlot: 'SP-',
  },
};

function completePrerequisiteSections() {
  commitCompanySection(SAMPLE_COMPANY);
  commitCommercialDefaultsSection(SAMPLE_COMMERCIAL);
}

describe('setup wizard progress flow', () => {
  beforeEach(() => storage.clear());

  it('does not mark cost codes complete when demo data is installed only', () => {
    getCommercialStructure();
    completePrerequisiteSections();
    const install = installDemoCostCodes();

    expect(install.ok).toBe(true);
    expect(listCostCodeMasterRecords().length).toBeGreaterThan(0);
    expect(isSectionComplete('costCodes')).toBe(false);
    expect(getFirstIncompleteStep()).toBe(4);
    expect(getCompletedSectionCount()).toBe(2);
  });

  it('commits cost code completion only when the section is explicitly saved', () => {
    getCommercialStructure();
    completePrerequisiteSections();
    const install = installDemoCostCodes();
    const draft = {
      mode: 'demo',
      demoInstalled: true,
      importCommitted: false,
      importSummary: { imported: install.imported, skipped: 0, mode: 'demo' },
    };

    const validation = validateCostCodesStep(draft, listCostCodeMasterRecords().length);
    expect(validation).toEqual({});

    const commit = commitCostCodesSection(draft);
    expect(commit.ok).toBe(true);
    expect(isSectionComplete('costCodes')).toBe(true);
    expect(getFirstIncompleteStep()).toBe(5);
    expect(getCompletedSectionCount()).toBe(3);
  });

  it('does not advance progress when cost code commit fails', () => {
    getCommercialStructure();
    completePrerequisiteSections();
    const commit = commitCostCodesSection({
      mode: 'import',
      importSummary: { imported: 0 },
    });

    expect(commit.ok).toBe(false);
    expect(isSectionComplete('costCodes')).toBe(false);
    expect(getFirstIncompleteStep()).toBe(4);
  });

  it('resumes from the first incomplete step when progress and draft diverge', () => {
    markSetupStarted();
    commitCompanySection({
      companyName: 'BuildLite Homes Ltd',
      tradingName: 'BuildLite',
      companyNumber: '12345678',
      vatNumber: 'GB123',
      addressLine1: '1 High Street',
      addressLine2: '',
      town: 'London',
      postcode: 'SW1A 1AA',
      financialYearStart: '04-01',
      currency: 'GBP',
    });
    commitCommercialDefaultsSection({
      defaultRetentionPercent: 5,
      vatRate: 20,
      defaultForecastBehaviour: 'Committed',
      numberingPrefixes: {
        development: 'DEV-',
        purchaseOrder: 'PO-',
        paymentCertificate: 'PC-',
        cvr: 'CVR-',
        variationOrder: 'VO-',
        salesPlot: 'SP-',
      },
    });

    saveOnboardingDraft({
      ...loadOnboardingDraft(),
      step: 5,
      costCodes: {
        mode: 'import',
        demoInstalled: false,
        importCommitted: false,
        importSummary: null,
      },
    });

    expect(getFirstIncompleteStep()).toBe(4);
    expect(getResumeStep(5)).toBe(4);
  });

  it('persists draft progress so setup can be exited and resumed later', () => {
    getCommercialStructure();
    completePrerequisiteSections();
    const install = installDemoCostCodes();

    saveOnboardingDraft({
      ...loadOnboardingDraft(),
      step: 4,
      costCodes: {
        mode: 'demo',
        demoInstalled: true,
        importCommitted: false,
        importSummary: { imported: install.imported, skipped: 0, mode: 'demo' },
      },
    });

    const reloaded = loadOnboardingDraft();
    expect(reloaded.step).toBe(4);
    expect(reloaded.costCodes.importSummary.imported).toBeGreaterThan(0);
    expect(isSectionComplete('costCodes')).toBe(false);
    expect(getResumeStep(reloaded.step)).toBe(4);
  });

  it('keeps navigation state aligned with committed progress after cost codes', () => {
    getCommercialStructure();
    markSectionComplete('company');
    markSectionComplete('commercialDefaults');

    const install = installDemoCostCodes();
    commitCostCodesSection({
      mode: 'demo',
      importSummary: { imported: install.imported, mode: 'demo' },
    });

    expect(getFirstIncompleteStep()).toBe(5);
    expect(isSectionComplete('costCodes')).toBe(true);
    expect(getCompletedSectionCount()).toBe(3);
  });
});
