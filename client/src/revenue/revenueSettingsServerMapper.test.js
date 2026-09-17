import { describe, expect, it } from 'vitest';
import { normalizeServerRevenueSettings, toServerRevenueSettingsPayload } from './revenueSettingsServerMapper';

describe('Summary Revenue server mapping', () => {
  it('preserves mode, stable lines, version and authenticated provenance', () => {
    const document = { id:'settings-1', developmentId:'dev-1', revenueMode:'summary', summaryRevenueLines:[{id:'line-1',description:'Private Sales',forecastRevenue:123.45}], revenueAuthority:{ready:true,summary:{forecastRevenue:123.45,securedRevenue:null}}, version:4, updatedBy:'QS', updatedByMembershipId:'membership-1' };
    const mapped = normalizeServerRevenueSettings(document, 'dev-1');
    expect(mapped.revenueMode).toBe('summary');
    expect(mapped.summaryRevenueLines).toEqual(document.summaryRevenueLines);
    expect(mapped.revenueAuthority).toEqual(document.revenueAuthority);
    expect(toServerRevenueSettingsPayload(mapped)).toMatchObject({ revenueMode:'summary', summaryRevenueLines:document.summaryRevenueLines, version:4 });
  });

  it('defaults historic settings to Sales Register', () => {
    expect(normalizeServerRevenueSettings({id:'settings-1'}, 'dev-1').revenueMode).toBe('sales_register');
  });
});
