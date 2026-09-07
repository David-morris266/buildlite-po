import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';
import { formatMoneyLabel } from '../payments/paymentCertificateProgress';
import {
  buildReconcileFacts,
  dateLabel,
  deductionMoney,
  MoneyRows,
  signedMoney,
} from './PaymentCertificateReconcile';

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

export function VariationAuthorityItems({ items }) {
  if (!items.length) return null;
  return (
    <div className="po-cert-approval__authority-items" aria-label="Commercial items in this certificate">
      {items.map((item) => {
        const assessment = Number(item.signedAmount) || 0;
        const unsupported = Number(item.unapprovedAmount) || 0;
        const appliedSupport = assessment - unsupported;
        const sources = item.authorityClassification?.supportingSources || [];
        const warning = unsupported !== 0;
        return (
          <article className={`po-cert-approval__authority-item${warning ? ' po-cert-approval__authority-item--warning' : ''}`} key={item.id}>
            <header>
              <strong>{item.variationReference || 'Variation Account item'}{item.description ? ` — ${item.description}` : ''}</strong>
              <span className={`po-status-badge po-status-badge--${warning ? 'warning' : 'approved'}`}>
                {warning ? (appliedSupport !== 0 ? 'Partly supported' : 'Unapproved') : 'Supported'}
              </span>
            </header>
            <dl>
              <div><dt>This certificate</dt><dd>{formatMoneyLabel(assessment)}</dd></div>
              <div>
                <dt>{sources.length ? 'Supported by' : 'Supported'}</dt>
                <dd>
                  {sources.length ? sources.map((source) => (
                    <span className="po-cert-approval__authority-source" key={source.allocationId || `${source.sourceReference}-${source.appliedAmount}`}>
                      {source.sourceReference || 'Prior authority'} {formatMoneyLabel(source.appliedAmount)}
                    </span>
                  )) : formatMoneyLabel(appliedSupport)}
                </dd>
              </div>
              {warning ? <div className="po-cert-approval__authority-unapproved"><dt>Unapproved</dt><dd>{formatMoneyLabel(unsupported)}</dd></div> : null}
            </dl>
          </article>
        );
      })}
    </div>
  );
}

export default function PaymentCertificateApprovalReview({
  certificate,
  totals,
  applicationComparison,
  auditItems = [],
  valuationDetail = null,
  onApprove,
  onReturnToDraft,
  busy = false,
  approveDisabled = false,
}) {
  const canLock = useBuildLitePermission('certificate.lock');
  const sourceAuthority = certificate?.sourceAuthority || {};
  const facts = buildReconcileFacts({ totals, sourceAuthority, applicationComparison });
  const unapproved = Number(sourceAuthority.unapprovedCertifiedGross) || 0;
  const timetable = certificate?.paymentTimetable;
  const dates = timetable?.readiness === 'ready' ? timetable.dates : null;
  const application = certificate?.submissionApplicationSnapshot?.application;
  const submittedAt = dateTimeLabel(certificate?.submittedAt);
  const authorityEvidence = sourceAuthority?.evidence?.variationAssessments || [];
  const differenceDescription = facts.difference == null
    ? 'No comparable contractor application was captured at submission.'
    : facts.difference === 0
      ? 'BuildLite Assessment matches the contractor application.'
      : `BuildLite Assessment is ${formatMoneyLabel(Math.abs(facts.difference))} ${facts.difference > 0 ? 'above' : 'below'} the contractor application.`;

  return (
    <section className="po-cert-approval" aria-labelledby="payment-certificate-approval-title">
      <header className="po-cert-approval__header">
        <div>
          <p className="po-cert-detail__eyebrow">Submitted for Approval</p>
          <h2 id="payment-certificate-approval-title">Certificate decision</h2>
          {certificate?.submittedBy || submittedAt ? (
            <p>
              {certificate.submittedBy ? `Submitted by ${certificate.submittedBy}` : 'Submitted'}
              {submittedAt ? ` · ${submittedAt}` : ''}
            </p>
          ) : null}
        </div>
      </header>

      <div className="po-cert-submit__position po-cert-approval__position">
        <div><span>Contractor Application</span><strong>{formatMoneyLabel(facts.applicationGross)}</strong></div>
        <div><span>BuildLite Assessment</span><strong>{formatMoneyLabel(totals?.grossWorksThisCertificate)}</strong></div>
        <div><span>Difference</span><strong>{signedMoney(facts.difference)}</strong></div>
        <div className="po-cert-submit__net"><span>Net Payment</span><strong>{formatMoneyLabel(totals?.netPayment)}</strong></div>
      </div>
      <p className="po-cert-submit__difference">{differenceDescription}</p>

      <div className="po-cert-reconcile__sections po-cert-approval__sections">
        <section>
          <h3>Assessment breakdown</h3>
          <MoneyRows rows={[
            { label: 'Ordered Works', value: formatMoneyLabel(facts.orderedWorks) },
            { label: 'Variation assessments', value: signedMoney(facts.variationAssessments) },
            ...(facts.otherAssessedItems !== 0 ? [{ label: 'Other assessed commercial items', value: signedMoney(facts.otherAssessedItems) }] : []),
            { label: 'Gross assessment', value: formatMoneyLabel(totals?.grossWorksThisCertificate), emphasis: true },
          ]} />
        </section>

        <section>
          <h3>Payment calculation</h3>
          <MoneyRows rows={[
            { label: `Retention${totals?.retentionRate != null ? ` (${Number(totals.retentionRate) * 100}%)` : ''}`, value: deductionMoney(totals?.retention) },
            { label: 'Recoveries', value: signedMoney(totals?.recoveryDeductionSigned) },
            { label: `VAT${totals?.vatRate != null ? ` (${Number(totals.vatRate) * 100}%)` : ''}`, value: formatMoneyLabel(totals?.vat) },
            { label: 'Net Payment', value: formatMoneyLabel(totals?.netPayment), emphasis: true },
          ]} />
        </section>

        <section>
          <h3>Commercial authority</h3>
          <VariationAuthorityItems items={authorityEvidence} />
          <MoneyRows rows={[
            { label: 'Current variation assessment', value: formatMoneyLabel(facts.variationAssessments) },
            { label: 'Supported by prior commercial authority', value: formatMoneyLabel(facts.supportedAssessment) },
            { label: 'Unapproved certified gross', value: formatMoneyLabel(unapproved), emphasis: true, modifier: unapproved > 0 ? 'warning' : null },
          ]} />
          {unapproved > 0 ? (
            <p className="po-cert-reconcile__warning" role="status">
              {formatMoneyLabel(unapproved)} of this assessment has no prior commercial authority. Review before approving.
            </p>
          ) : <p className="po-cert-submit__ok">This assessment contains no unapproved certified gross.</p>}
        </section>

        <section>
          <h3>Certificate position</h3>
          <MoneyRows rows={[
            { label: 'Previous certified', value: formatMoneyLabel(totals?.previousCertified) },
            { label: 'This certificate', value: formatMoneyLabel(totals?.grossWorksThisCertificate) },
            { label: 'Certified to date', value: formatMoneyLabel(totals?.certifiedToDate) },
            { label: 'Current Contract', value: formatMoneyLabel(totals?.currentContractValue) },
            { label: 'Remaining Contract', value: formatMoneyLabel(totals?.remainingContract), modifier: totals?.overCertified ? 'warning' : null },
          ]} />
          <p className="po-cert-approval__context-note">Current Contract and Remaining Contract are live package context and were not frozen at submission.</p>
        </section>
      </div>

      <section className="po-cert-approval__exceptions" aria-label="Approval exceptions and key dates">
        <h3>Exceptions and key dates</h3>
        {(totals?.retentionErrors || []).map((error) => <p className="po-cert-reconcile__warning" role="status" key={error}>{error}</p>)}
        {dates ? (
          <dl>
            <div><dt>Due date</dt><dd>{dateLabel(dates.dueDate)}</dd></div>
            <div><dt>Pay Less deadline</dt><dd>{dateLabel(dates.payLessNoticeDeadline)}</dd></div>
          </dl>
        ) : (
          <p className="po-list-feedback po-list-feedback--warning" role="status">
            {timetable?.reasons?.[0] || 'Payment timetable dates are unavailable and require review.'}
          </p>
        )}
      </section>

      <details className="po-cert-approval__supporting">
        <summary>View supporting detail</summary>
        <div className="po-cert-approval__supporting-grid">
          <section>
            <h3>Contractor application evidence</h3>
            <MoneyRows rows={[
              { label: 'Reference', value: application?.applicationReference || 'Not captured' },
              { label: 'Received', value: dateLabel(application?.receivedAt) || 'Not captured' },
              { label: 'Application value', value: formatMoneyLabel(facts.applicationGross) },
            ]} />
          </section>
          <section>
            <h3>Variation authority evidence</h3>
            {authorityEvidence.length ? authorityEvidence.map((item) => (
              <div className="po-cert-approval__evidence" key={item.id}>
                <strong>{item.variationReference || 'Variation Account item'}{item.description ? ` — ${item.description}` : ''}</strong>
                <p>Assessment {formatMoneyLabel(item.signedAmount)} · supported {formatMoneyLabel(Number(item.signedAmount || 0) - Number(item.unapprovedAmount || 0))} · authority envelope {formatMoneyLabel(item.authorityClassification?.effectiveRecognisedAuthority)}</p>
                {(item.authorityClassification?.supportingSources || []).map((source) => <p key={source.allocationId}>{source.sourceReference}: {formatMoneyLabel(source.appliedAmount)} applied</p>)}
              </div>
            )) : <p>No variation assessment evidence applies.</p>}
          </section>
          <section>
            <h3>Source Authority</h3>
            <MoneyRows rows={[
              { label: 'Ordered work backed', value: formatMoneyLabel(sourceAuthority.orderedWorkBackedGross) },
              { label: 'Ordered excess', value: formatMoneyLabel(sourceAuthority.orderedWorkExcessGross) },
              { label: 'Approved PO authority', value: formatMoneyLabel(sourceAuthority.approvedPoAuthority) },
            ]} />
          </section>
          {auditItems.length ? <section><h3>Submission history</h3><ul>{auditItems.map((item) => <li key={item.id}><strong>{item.label}</strong> — {item.actor} · {item.dateLabel}{item.timeLabel ? ` · ${item.timeLabel}` : ''}{item.comment ? ` — ${item.comment}` : ''}</li>)}</ul></section> : null}
        </div>
        {valuationDetail}
      </details>

      <div className="po-cert-approval__decision">
        <div>
          <strong>Approval decision</strong>
          <p>Approve &amp; Lock recalculates and revalidates the certificate, then freezes its final financial and Source Authority evidence.</p>
          <p>Return to Draft restores editing and requires a reason.</p>
        </div>
        {canLock ? <div className="po-cert-approval__decision-actions"><button type="button" className="po-btn-primary" onClick={onApprove} disabled={busy || approveDisabled}>Approve &amp; Lock</button><button type="button" className="po-list-btn-secondary" onClick={onReturnToDraft} disabled={busy}>Return to Draft</button></div> : <p className="po-cert-detail__readonly-note">You do not have permission to approve or return this certificate to Draft.</p>}
      </div>
    </section>
  );
}
