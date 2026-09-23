import { describe, expect, it } from 'vitest';
import { buildChangeExposureByCostCode } from './cvrChangeExposure';

const ce = (id, value, extra = {}) => ({ id, value, status: 'submitted', costCode: '4100', expectedTreatment: 'default', ...extra });
const va = (id, amount, sourceCommercialEventId = null) => ({ variationAccountItemId: id, costCode: '4100', vaExposureUplift: amount, sourceCommercialEventId });

describe('client Change Exposure parity', () => {
  it('converges explicit identity and keeps independent changes additive', () => {
    expect(buildChangeExposureByCostCode([ce('ce-1', 20000)], [va('va-1', 30000, 'ce-1')]).totals.get('4100')).toBe(30000);
    expect(buildChangeExposureByCostCode([ce('ce-1', 20000)], [va('va-1', 30000)]).totals.get('4100')).toBe(50000);
  });

  it('converges £5k Expected Liability with £5k/£7.5k linked VA forecasts', () => {
    const event=ce('ce-hg002',20000,{expectedTreatment:'override',expectedAmount:5000});
    expect(buildChangeExposureByCostCode([event],[va('va-hg002',5000,'ce-hg002')]).totals.get('4100')).toBe(5000);
    expect(buildChangeExposureByCostCode([event],[va('va-hg002',7500,'ce-hg002')]).totals.get('4100')).toBe(7500);
  });

  it('honours hold and fails closed on opposing signs', () => {
    expect(buildChangeExposureByCostCode([ce('ce-1', 20000, { expectedTreatment: 'hold' })], [va('va-1', 30000, 'ce-1')]).totals.get('4100')).toBe(0);
    expect(buildChangeExposureByCostCode([ce('ce-1', 20000)], [va('va-1', -30000, 'ce-1')]).blockers).toHaveLength(1);
  });
});
