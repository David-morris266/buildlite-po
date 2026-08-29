import { describe, expect, it } from 'vitest';
import { APPLICATION_BASES, comparePaymentApplication } from './paymentApplicationComparison';

describe('payment application comparison', () => {
  it('shows negative, zero and positive assessment-minus-application variance', () => {
    const application={applicationBasis:APPLICATION_BASES.currentPeriodGross,currentPeriodGrossClaimed:1500};
    expect(comparePaymentApplication(application,1000).difference).toBe(-500);
    expect(comparePaymentApplication(application,1500).difference).toBe(0);
    expect(comparePaymentApplication(application,1600).difference).toBe(100);
  });
  it('normalises both cumulative bases without conflating prior applied and certified',()=>{
    expect(comparePaymentApplication({applicationBasis:APPLICATION_BASES.cumulativeLessPreviousApplication,cumulativeGrossClaimed:100,previousApplicationStated:70},27).applicationCurrentGross).toBe(30);
    expect(comparePaymentApplication({applicationBasis:APPLICATION_BASES.cumulativeLessPreviousCertified,cumulativeGrossClaimed:100,previousCertifiedStated:68},27).applicationCurrentGross).toBe(32);
  });
  it('does not manufacture zero for missing or net-only facts',()=>{
    expect(comparePaymentApplication({applicationBasis:APPLICATION_BASES.currentPeriodGross},0).comparable).toBe(false);
    expect(comparePaymentApplication({applicationBasis:APPLICATION_BASES.netOnly,netRequestedStated:1000},1000).comparable).toBe(false);
  });
});
