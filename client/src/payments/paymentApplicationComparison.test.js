import { describe, expect, it } from 'vitest';
import { APPLICATION_BASES, comparePaymentApplication, validatePaymentApplicationBasis } from './paymentApplicationComparison';

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
    const netOnly=comparePaymentApplication({applicationBasis:APPLICATION_BASES.netOnly,netRequestedStated:1000},900);
    expect(netOnly.comparable).toBe(false);
    expect(netOnly.applicationCurrentGross).toBeNull();
    expect(netOnly.applicationNetRequested).toBe(1000);
    expect(netOnly.difference).toBeNull();
  });
  it('matches server basis completeness and keeps contractor-stated previous certified distinct',()=>{
    expect(validatePaymentApplicationBasis({applicationBasis:APPLICATION_BASES.currentPeriodGross,currentPeriodGrossClaimed:0}).valid).toBe(true);
    expect(validatePaymentApplicationBasis({applicationBasis:APPLICATION_BASES.currentPeriodGross}).errors).toHaveProperty('currentPeriodGrossClaimed');
    expect(validatePaymentApplicationBasis({applicationBasis:APPLICATION_BASES.cumulativeLessPreviousApplication,cumulativeGrossClaimed:100}).errors).toHaveProperty('previousApplicationStated');
    expect(validatePaymentApplicationBasis({applicationBasis:APPLICATION_BASES.cumulativeLessPreviousCertified,cumulativeGrossClaimed:100}).errors.previousCertifiedStated).toMatch(/contractor\/application/);
    expect(validatePaymentApplicationBasis({applicationBasis:APPLICATION_BASES.netOnly,netRequestedStated:90}).valid).toBe(true);
    expect(validatePaymentApplicationBasis({applicationBasis:APPLICATION_BASES.netOnly}).errors).toHaveProperty('netRequestedStated');
    expect(comparePaymentApplication({applicationBasis:APPLICATION_BASES.cumulativeLessPreviousCertified,cumulativeGrossClaimed:100.01,previousCertifiedStated:40.02},59.99).applicationCurrentGross).toBe(59.99);
  });
});
