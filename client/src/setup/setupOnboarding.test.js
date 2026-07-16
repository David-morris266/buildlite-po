import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { getCommercialStructure } from '../admin/commercialStructureStore';
import { getCompanySettings } from '../admin/companyStore';
import { listCostCodeMasterRecords } from '../admin/costCodeMasterStore';
import {
  getCompletedSectionCount,
  getSetupPercentComplete,
  isSectionComplete,
  isSetupComplete,
  markSectionComplete,
  markSetupStarted,
} from './setupProgressStore';
import { validateCostCodeImport } from './costCodeImportService';
import { commitCompanySection, installDemoCostCodes } from './setupCommit';
import { validateCompanyStep } from './onboardingDraft';

describe('setupProgressStore', () => {
  beforeEach(() => storage.clear());

  it('tracks section completion and percent complete', () => {
    markSetupStarted();
    markSectionComplete('company');
    markSectionComplete('commercialDefaults');
    expect(getCompletedSectionCount()).toBe(2);
    expect(getSetupPercentComplete()).toBeGreaterThan(0);
    expect(isSetupComplete()).toBe(false);
    markSectionComplete('complete');
    expect(isSetupComplete()).toBe(true);
  });
});

describe('onboarding company validation', () => {
  it('requires core company fields', () => {
    const errors = validateCompanyStep({ companyName: '', addressLine1: '', town: '', postcode: '' });
    expect(errors.companyName).toBeTruthy();
    expect(errors.addressLine1).toBeTruthy();
  });
});

describe('setup commit', () => {
  beforeEach(() => storage.clear());

  it('commits company settings to administration store', () => {
    getCommercialStructure();
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
    expect(getCompanySettings().companyName).toBe('BuildLite Homes Ltd');
    expect(getCompanySettings().currency).toBe('GBP');
  });
});

describe('cost code import validation', () => {
  beforeEach(() => storage.clear());

  it('detects duplicate and blank cost codes', () => {
    getCommercialStructure();
    const parsed = {
      headerRowIndex: 0,
      fieldByColumn: ['costCode', 'description', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore'],
      rows: [
        ['Cost Code', 'Description'],
        ['BRK', 'Brickwork'],
        ['BRK', 'Brickwork duplicate'],
        ['', 'Missing code'],
        ['ROOF', ''],
      ],
    };

    const result = validateCostCodeImport(parsed);
    expect(result.summary.validCount).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('demo cost codes', () => {
  beforeEach(() => storage.clear());

  it('installs demo codes only when explicitly chosen', () => {
    getCommercialStructure();
    const result = installDemoCostCodes();
    expect(result.ok).toBe(true);
    expect(result.imported).toBeGreaterThan(0);
    expect(listCostCodeMasterRecords().length).toBeGreaterThan(0);
    expect(isSectionComplete('costCodes')).toBe(false);
  });
});
