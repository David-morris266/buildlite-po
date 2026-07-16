import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { saveCompanySettings } from '../admin/companyStore';
import { addClient, listClients } from '../admin/clientStore';
import { validateDevelopmentStep } from './onboardingDraft';
import {
  getDefaultCompanyClientName,
  resolveSetupClientDefault,
  shouldUseSetupClientDropdown,
} from './setupClientDefaults';

describe('setup development defaults', () => {
  beforeEach(() => storage.clear());

  it('defaults the client to the company name when no clients exist', () => {
    saveCompanySettings({
      companyName: 'DM Commercial Consulting Ltd',
      tradingName: 'DM Commercial',
    });

    expect(getDefaultCompanyClientName()).toBe('DM Commercial Consulting Ltd');
    expect(resolveSetupClientDefault()).toBe('DM Commercial Consulting Ltd');
    expect(shouldUseSetupClientDropdown()).toBe(false);
  });

  it('uses the dropdown when multiple clients exist', () => {
    addClient({ name: 'Riverside Developments' });
    addClient({ name: 'Harbour Homes' });

    expect(listClients()).toHaveLength(2);
    expect(shouldUseSetupClientDropdown()).toBe(true);
    expect(resolveSetupClientDefault()).toBe('');
  });

  it('only requires the development name during setup validation', () => {
    expect(validateDevelopmentStep({
      developmentName: '',
      developmentCode: 'DEV-001',
      client: '',
    })).toEqual({
      developmentName: 'Development name is required.',
    });

    expect(validateDevelopmentStep({
      developmentName: 'Oakwood Meadows',
      developmentCode: '',
      client: '',
    })).toEqual({});
  });
});
