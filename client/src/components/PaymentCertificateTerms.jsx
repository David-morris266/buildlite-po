import { selectPaymentCertificateTerms } from '../payments/paymentCertificateTermsPresentation';

function formatCapturedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PaymentCertificateTerms({ certificate, governingTerms }) {
  const terms = selectPaymentCertificateTerms(certificate, governingTerms);
  const captured = formatCapturedAt(terms.capturedAt);
  const title = terms.available
    ? [
        terms.familyName,
        terms.versionLabel,
        terms.revisionNumber != null ? `Revision ${terms.revisionNumber}` : null,
      ].filter(Boolean).join(' · ')
    : terms.message;

  return (
    <section className="po-module-card" aria-labelledby="certificate-terms-title">
      <div>
        <h3 id="certificate-terms-title" className="po-matrix-section__title">
          Contract terms for this payment cycle
        </h3>
        <p className="po-cert-detail__readonly-note">
          {title || 'Contract terms unavailable'}
        </p>
      </div>
      <dl className="po-cert-detail__meta">
        {terms.sourceLabel ? (
          <div>
            <dt>Source</dt>
            <dd>{terms.sourceLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt>State</dt>
          <dd>{terms.stateLabel}</dd>
        </div>
        {captured ? (
          <div>
            <dt>Captured</dt>
            <dd>{captured}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
