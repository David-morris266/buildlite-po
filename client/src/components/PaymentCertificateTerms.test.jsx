/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import PaymentCertificateTerms from './PaymentCertificateTerms';

describe('PaymentCertificateTerms', () => {
  let host;
  let root;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  function render(certificate, governingTerms) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<PaymentCertificateTerms certificate={certificate} governingTerms={governingTerms} />));
    return host.textContent;
  }

  it('renders the authority, source, state and frozen timestamp', () => {
    const text = render({
      status: 'submitted',
      submissionGoverningTermsSnapshot: {
        state: 'common',
        readiness: 'configured',
        familyName: 'Standard Subcontract Terms',
        versionLabel: 'Standard 2026',
        revisionNumber: 1,
        source: 'tenant_default',
        capturedAt: '2026-08-30T16:00:00.000Z',
      },
    });

    expect(text).toContain('Contract terms for this payment cycle');
    expect(text).toContain('Standard Subcontract Terms');
    expect(text).toContain('Standard 2026');
    expect(text).toContain('Revision 1');
    expect(text).toContain('Submitted snapshot');
    expect(text).toContain('Captured');
  });

  it('does not render a capture timestamp for live Draft authority', () => {
    const text = render({ status: 'draft' }, {
      state: 'common',
      source: 'tenant_default',
      version: { familyName: 'Standard Terms', revisionNumber: 1 },
    });

    expect(text).toContain('Live Draft authority');
    expect(text).not.toContain('Captured');
  });
});
