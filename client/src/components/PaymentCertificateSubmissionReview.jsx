import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';
import { formatMoneyLabel } from '../payments/paymentCertificateProgress';

const toPence = (value) => Math.round((Number(value) || 0) * 100);

function signedMoney(value) {
  if (value == null || value === '') return '—';
  const amount = Number(value) || 0;
  if (amount < 0) return `−${formatMoneyLabel(Math.abs(amount))}`;
  if (amount > 0) return `+${formatMoneyLabel(amount)}`;
  return formatMoneyLabel(0);
}

function dateLabel(value) {
  if (!value) return '—';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London',
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

function supportedAssessment(sourceAuthority) {
  const pence = (sourceAuthority?.evidence?.variationAssessments || []).reduce(
    (sum, item) => sum + toPence(item.signedAmount) - toPence(item.unapprovedAmount),
    0
  );
  return pence / 100;
}

export default function PaymentCertificateSubmissionReview({
  certificate,
  totals,
  applicationComparison,
  onEditStage,
  onSubmit,
  busy = false,
}) {
  const canSubmit = useBuildLitePermission('certificate.submit');
  const sourceAuthority = certificate?.sourceAuthority || {};
  const timetable = certificate?.paymentTimetable;
  const dates = timetable?.readiness === 'ready' ? timetable.dates : null;
  const unapproved = Number(sourceAuthority.unapprovedCertifiedGross) || 0;
  const difference = applicationComparison?.comparable ? applicationComparison.difference : null;
  const applicationGross = applicationComparison?.comparable
    ? applicationComparison.applicationCurrentGross
    : null;
  const differenceDescription = difference == null
    ? 'No comparable contractor application is currently available.'
    : difference === 0
      ? 'BuildLite Assessment matches the contractor application.'
      : `BuildLite Assessment is ${formatMoneyLabel(Math.abs(difference))} ${difference > 0 ? 'above' : 'below'} the contractor application.`;

  return (
    <section className="po-module-card po-cert-submit" aria-labelledby="payment-certificate-submit-title">
      <header>
        <p className="po-cert-detail__eyebrow">Stage 5</p>
        <h3 id="payment-certificate-submit-title">Final review</h3>
        <p>Confirm the certificate position before submitting it for approval.</p>
      </header>

      <div className="po-cert-submit__position">
        <div><span>Contractor Application</span><strong>{formatMoneyLabel(applicationGross)}</strong></div>
        <div><span>BuildLite Assessment</span><strong>{formatMoneyLabel(totals?.grossWorksThisCertificate)}</strong></div>
        <div><span>Difference</span><strong>{signedMoney(difference)}</strong></div>
        <div className="po-cert-submit__net"><span>Net Payment</span><strong>{formatMoneyLabel(totals?.netPayment)}</strong></div>
      </div>
      <p className="po-cert-submit__difference">{differenceDescription}</p>

      <div className="po-cert-submit__review-grid">
        <section>
          <h4>Commercial authority</h4>
          <dl>
            <div><dt>Assessment supported by prior commercial authority</dt><dd>{formatMoneyLabel(supportedAssessment(sourceAuthority))}</dd></div>
            <div><dt>Unapproved certified gross</dt><dd>{formatMoneyLabel(unapproved)}</dd></div>
          </dl>
          {unapproved > 0 ? <p className="po-cert-submit__warning" role="status">{formatMoneyLabel(unapproved)} of this assessment has no prior commercial authority. Review before submitting.</p> : <p className="po-cert-submit__ok">No unapproved certified gross in this assessment.</p>}
        </section>

        <section>
          <h4>Key dates</h4>
          {dates ? <dl><div><dt>Due date</dt><dd>{dateLabel(dates.dueDate)}</dd></div><div><dt>Pay Less deadline</dt><dd>{dateLabel(dates.payLessNoticeDeadline)}</dd></div></dl> : <p className="po-cert-submit__warning" role="status">Payment timetable dates are not currently available. Review before submitting.</p>}
          <p className="po-cert-submit__note">Notice and Pay Less requirements are confirmed from the locked certificate and payment timetable.</p>
        </section>
      </div>

      {(totals?.retentionErrors || []).map((error) => <p className="po-cert-submit__warning" role="status" key={error}>{error}</p>)}
      {!applicationComparison?.comparable ? <p className="po-cert-submit__warning" role="status">Resolve before submitting: review the contractor application evidence.</p> : null}

      <div className="po-cert-submit__review-actions" aria-label="Review certificate stages">
        <button type="button" className="po-cert-workspace__link" onClick={() => onEditStage?.('application')}>Review Application</button>
        <button type="button" className="po-cert-workspace__link" onClick={() => onEditStage?.('ordered-works')}>Review Ordered Works</button>
        <button type="button" className="po-cert-workspace__link" onClick={() => onEditStage?.('variations')}>Review Variations</button>
        <button type="button" className="po-cert-workspace__link" onClick={() => onEditStage?.('reconcile')}>Review Reconciliation</button>
      </div>

      <div className="po-cert-submit__handoff">
        <div>
          <strong>Submit this certificate for approval</strong>
          <p>It will become read-only until approved or returned to Draft. Final financial and source-authority evidence is frozen when it is approved and locked.</p>
        </div>
        {canSubmit ? <button type="button" className="po-btn-primary" onClick={onSubmit} disabled={busy}>Submit for Approval</button> : <p className="po-cert-detail__readonly-note">You do not have permission to submit this certificate for approval.</p>}
      </div>
    </section>
  );
}
