import { formatMoneyLabel } from '../payments/paymentCertificateProgress';
import {
  buildReconcileFacts,
  dateLabel,
  deductionMoney,
  MoneyRows,
  signedMoney,
} from './PaymentCertificateReconcile';
import { VariationAuthorityItems } from './PaymentCertificateApprovalReview';

function dateTimeLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(date);
}

export default function PaymentCertificateLockedRecord({
  certificate,
  totals,
  applicationComparison,
  supportingDetail,
  noticeAndDocuments,
}) {
  const sourceAuthority = certificate?.sourceAuthority || {};
  const facts = buildReconcileFacts({ totals, sourceAuthority, applicationComparison });
  const authorityEvidence = sourceAuthority?.evidence?.variationAssessments || [];
  const unapproved = Number(sourceAuthority.unapprovedCertifiedGross) || 0;
  const timetable = certificate?.paymentTimetable;
  const dates = timetable?.readiness === 'ready' ? timetable.dates : null;
  const application = certificate?.lockedApplicationSnapshot?.application;
  const approvedAt = dateTimeLabel(certificate?.approvedAt);

  return (
    <section className="po-cert-locked" aria-labelledby="payment-certificate-locked-title">
      <header className="po-cert-locked__header">
        <div>
          <p className="po-cert-detail__eyebrow">Approved &amp; Locked</p>
          <h2 id="payment-certificate-locked-title">Immutable commercial record</h2>
          <p>Approved commercial record. Certificate values are permanently locked.</p>
          {certificate?.approvedBy || approvedAt ? (
            <p>{certificate.approvedBy ? `Approved and locked by ${certificate.approvedBy}` : 'Approved and locked'}{approvedAt ? ` · ${approvedAt}` : ''}</p>
          ) : null}
        </div>
      </header>

      <div className="po-cert-submit__position po-cert-locked__position">
        <div><span>Contractor Application</span><strong>{formatMoneyLabel(facts.applicationGross)}</strong></div>
        <div><span>Certified Assessment</span><strong>{formatMoneyLabel(totals?.grossWorksThisCertificate)}</strong></div>
        <div><span>Difference</span><strong>{signedMoney(facts.difference)}</strong></div>
        <div className="po-cert-submit__net"><span>Net Payment</span><strong>{formatMoneyLabel(totals?.netPayment)}</strong></div>
      </div>

      <div className="po-cert-reconcile__sections po-cert-locked__sections">
        <section>
          <h3>Frozen assessment breakdown</h3>
          <MoneyRows rows={[
            { label: 'Ordered Works', value: formatMoneyLabel(facts.orderedWorks) },
            { label: 'Variation assessments', value: signedMoney(facts.variationAssessments) },
            ...(facts.otherAssessedItems !== 0 ? [{ label: 'Other assessed commercial items', value: signedMoney(facts.otherAssessedItems) }] : []),
            { label: 'Gross assessment', value: formatMoneyLabel(totals?.grossWorksThisCertificate), emphasis: true },
          ]} />
        </section>

        <section>
          <h3>Frozen payment calculation</h3>
          <MoneyRows rows={[
            { label: `Retention${totals?.retentionRate != null ? ` (${Number(totals.retentionRate) * 100}%)` : ''}`, value: deductionMoney(totals?.retention) },
            { label: 'Recoveries', value: signedMoney(totals?.recoveryDeductionSigned) },
            { label: `VAT${totals?.vatRate != null ? ` (${Number(totals.vatRate) * 100}%)` : ''}`, value: formatMoneyLabel(totals?.vat) },
            { label: 'Net Payment', value: formatMoneyLabel(totals?.netPayment), emphasis: true },
          ]} />
        </section>

        <section>
          <h3>Frozen commercial authority</h3>
          <VariationAuthorityItems items={authorityEvidence} />
          <MoneyRows rows={[
            { label: 'Supported by prior commercial authority', value: formatMoneyLabel(facts.supportedAssessment) },
            { label: 'Unapproved certified gross', value: formatMoneyLabel(unapproved), emphasis: true, modifier: unapproved !== 0 ? 'warning' : null },
          ]} />
          {unapproved !== 0 ? <p className="po-cert-reconcile__warning">This locked record contains {formatMoneyLabel(unapproved)} of unapproved certified gross.</p> : <p className="po-cert-submit__ok">This locked assessment contains no unapproved certified gross.</p>}
        </section>

        <section>
          <h3>Frozen certificate position</h3>
          <MoneyRows rows={[
            { label: 'Previous certified', value: formatMoneyLabel(totals?.previousCertified) },
            { label: 'This certificate', value: formatMoneyLabel(totals?.grossWorksThisCertificate) },
            { label: 'Certified to date', value: formatMoneyLabel(totals?.certifiedToDate), emphasis: true },
          ]} />
        </section>
      </div>

      <section className="po-cert-locked__exceptions" aria-label="Locked payment timetable and terms status">
        <h3>Payment timetable &amp; terms</h3>
        {dates ? (
          <dl>
            <div><dt>Due date</dt><dd>{dateLabel(dates.dueDate)}</dd></div>
            <div><dt>Final date for payment</dt><dd>{dateLabel(dates.finalDateForPayment)}</dd></div>
            <div><dt>Pay Less deadline</dt><dd>{dateLabel(dates.payLessNoticeDeadline)}</dd></div>
          </dl>
        ) : <p className="po-list-feedback po-list-feedback--warning">{timetable?.reasons?.[0] || 'Frozen governing payment-rule authority was unavailable or requires review.'}</p>}
      </section>

      <details className="po-cert-locked__supporting">
        <summary>View supporting detail</summary>
        <div className="po-cert-locked__application">
          <h3>Frozen application evidence</h3>
          <MoneyRows rows={[
            { label: 'Reference', value: application?.applicationReference || 'Not captured' },
            { label: 'Received', value: dateLabel(application?.receivedAt) || 'Not captured' },
            { label: 'Application value', value: formatMoneyLabel(facts.applicationGross) },
          ]} />
        </div>
        {supportingDetail}
      </details>

      <section className="po-cert-locked__post-lock" aria-label="Notice and documents">
        <header><p className="po-cert-detail__eyebrow">Post-Lock workflow</p><h2>Notice &amp; documents</h2><p>Certificate evidence above is permanently locked. These downstream notice and document actions do not change the approved record.</p></header>
        {noticeAndDocuments}
      </section>
    </section>
  );
}
