import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PaymentCertificateSourceAuthority from './PaymentCertificateSourceAuthority';

describe('PaymentCertificateSourceAuthority', () => {
  it('renders VA assessment authority with no legacy discovered items', () => {
    const html = renderToStaticMarkup(<PaymentCertificateSourceAuthority certificate={{
      sourceAuthority: {
        state: 'captured',
        orderedWorkGross: 0,
        approvedPoAuthority: 1000,
        orderedWorkBackedGross: 0,
        orderedWorkExcessGross: 0,
        approvedCeGross: 0,
        issuedVoGross: 0,
        variationAssessmentGross: 8000,
        unapprovedCertifiedGross: 8000,
        evidence: { variationAssessments: [{ id: 'va-a1', variationReference: 'VA-0001', description: 'Drainage design changes', signedAmount: 8000, priorAuthority: 0, unapprovedAmount: 8000 }] },
      },
      paymentDiscoveredItems: [],
    }} />);
    expect(html).toContain('Variation Account assessment');
    expect(html).toContain('VA-0001');
    expect(html).toContain('Drainage design changes');
    expect(html).toContain('prior authority £0.00');
    expect(html.match(/£8,000.00/g)).toHaveLength(4);
    expect(html).toContain('No legacy payment-discovered items');
    expect(html).not.toContain('Add item');
  });

  it('preserves legacy Migration 032 evidence read-only', () => {
    const html = renderToStaticMarkup(<PaymentCertificateSourceAuthority certificate={{
      sourceAuthority: { state: 'captured' },
      paymentDiscoveredItems: [{ id: 'pd', description: 'Historic £200', basis: 'Historic QS basis', status: 'draft', signedAmount: 200 }],
    }} />);
    expect(html).toContain('Legacy payment-discovered evidence');
    expect(html).toContain('Historic £200');
    expect(html).not.toContain('Remove');
  });

  it('renders old locked certificates as not captured, not fake zero', () => {
    const html = renderToStaticMarkup(<PaymentCertificateSourceAuthority certificate={{ sourceAuthority: { state: 'not_captured' } }} />);
    expect(html).toContain('source authority not captured');
    expect(html).not.toContain('Unapproved certified gross');
  });
});
