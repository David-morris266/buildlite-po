/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authorityEnabled = vi.hoisted(() => ({ value: true }));
const ensureCostCodesReady = vi.hoisted(() => vi.fn());

vi.mock('./costCodeAuthority', () => ({
  isCostCodeServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('./costCodeServerCache', () => ({
  ensureCostCodesReady,
}));

import { COST_CODE_MASTER_KEY } from './costCodeMasterStore';
import { listCostCodesForTemplateMapping } from './prelimsTemplateCostCodes';

describe('prelimsTemplateCostCodes', () => {
  beforeEach(() => {
    localStorage.clear();
    authorityEnabled.value = true;
    ensureCostCodesReady.mockReset();
    ensureCostCodesReady.mockResolvedValue([
      {
        code: '5231',
        description: 'Cleaning',
        reportingGroup: 'Plot & Housebuild Costs - 52',
        active: true,
      },
      {
        code: 'P100-SM',
        description: 'Site manager',
        reportingGroup: 'Prelims',
        active: true,
      },
    ]);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('maps from the server cache using canonical code identity only', async () => {
    const options = await listCostCodesForTemplateMapping();
    expect(ensureCostCodesReady).toHaveBeenCalled();
    expect(options.map((row) => row.code)).toEqual(['5231', 'P100-SM']);
    expect(options.map((row) => row.value)).toEqual(['5231', 'P100-SM']);
    expect(options[0].value).not.toContain('Cleaning');
    expect(localStorage.getItem(COST_CODE_MASTER_KEY)).toBeNull();
  });
});
