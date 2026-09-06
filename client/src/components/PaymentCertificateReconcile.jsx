import { formatMoneyLabel } from '../payments/paymentCertificateProgress';

const toPence = (value) => Math.round((Number(value) || 0) * 100);
const fromPence = (value) => value / 100;

function signedMoney(value) {
  if (value == null || value === '') return '—';
  const amount = Number(value) || 0;
  if (amount < 0) return `−${formatMoneyLabel(Math.abs(amount))}`;
  if (amount > 0) return `+${formatMoneyLabel(amount)}`;
  return formatMoneyLabel(0);
}

function deductionMoney(value) {
  if (value == null || value === '') return '—';
  const amount = Number(value) || 0;
  return amount > 0
    ? `−${formatMoneyLabel(amount)}`
    : amount < 0
      ? `+${formatMoneyLabel(Math.abs(amount))}`
      : formatMoneyLabel(0);
}

function dateLabel(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London',
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

function buildReconcileFacts({ totals, sourceAuthority, applicationComparison }) {
  const variationPence = toPence(sourceAuthority?.variationAssessmentGross);
  const commercialPence = toPence(totals?.commercialEventGrossThisCertificate);
  const supportedPence = (sourceAuthority?.evidence?.variationAssessments || []).reduce(
    (sum, item) => sum + toPence(item.signedAmount) - toPence(item.unapprovedAmount),
    0
  );

  return {
    applicationGross: applicationComparison?.comparable
      ? Number(applicationComparison.applicationCurrentGross)
      : null,
    difference: applicationComparison?.comparable
      ? Number(applicationComparison.difference)
      : null,
    orderedWorks: totals?.matrixGrossThisCertificate,
    variationAssessments: fromPence(variationPence),
    otherAssessedItems: fromPence(commercialPence - variationPence),
    supportedAssessment: fromPence(supportedPence),
  };
}

function MoneyRows({ rows }) {
  return (
    <dl className="po-cert-reconcile__rows">
      {rows.map(({ label, value, emphasis, modifier }) => (
        <div key={label} className={emphasis ? 'po-cert-reconcile__row--emphasis' : undefined}>
          <dt>{label}</dt>
          <dd className={modifier ? `po-cert-reconcile__money po-cert-reconcile__money--${modifier}` : 'po-cert-reconcile__money'}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function PaymentCertificateReconcile({
  certificate,
  totals,
  applicationComparison,
  onEditStage,
}) {
  const sourceAuthority = certificate?.sourceAuthority || {};
  const facts = buildReconcileFacts({ totals, sourceAuthority, applicationComparison });
  const timetable = certificate?.paymentTimetable;
  const dates = timetable?.readiness === 'ready' ? timetable.dates : null;
  const unapproved = Number(sourceAuthority.unapprovedCertifiedGross) || 0;
  const retentionErrors = totals?.retentionErrors || [];
  const retentionRate = totals?.retentionRate ?? certificate?.retentionRate;
  const vatRate = totals?.vatRate ?? certificate?.vatRate;

  return (
    <section className="po-module-card po-cert-reconcile" aria-labelledby="payment-certificate-reconcile-title">
      <header className="po-cert-reconcile__header">
        <div>
          <p className="po-cert-detail__eyebrow">Stage 4</p>
          <h3 id="payment-certificate-reconcile-title">Reconcile</h3>
          <p>Compare the contractor application with BuildLite's assessment before release.</p>
        </div>
      </header>

      {!applicationComparison?.comparable ? (
        <div className="po-list-feedback po-list-feedback--warning" role="status">
          Resolve before release: no comparable contractor application is currently available.
        </div>
      ) : null}

      <div className="po-cert-reconcile__comparison">
        <div><span>Contractor application</span><strong>{formatMoneyLabel(facts.applicationGross)}</strong></div>
        <div><span>BuildLite assessment</span><strong>{formatMoneyLabel(totals?.grossWorksThisCertificate)}</strong></div>
        <div><span>Difference</span><strong>{signedMoney(facts.difference)}</strong></div>
      </div>

      <div className="po-cert-reconcile__sections">
        <section>
          <h4>Assessment breakdown</h4>
          <MoneyRows rows={[
            { label: 'Ordered Works', value: formatMoneyLabel(facts.orderedWorks) },
            { label: 'Variation assessments', value: signedMoney(facts.variationAssessments) },
            ...(facts.otherAssessedItems !== 0 ? [{ label: 'Other assessed commercial items', value: signedMoney(facts.otherAssessedItems) }] : []),
            { label: 'Gross assessment', value: formatMoneyLabel(totals?.grossWorksThisCertificate), emphasis: true },
          ]} />
        </section>

        <section>
          <h4>Payment calculation</h4>
          <MoneyRows rows={[
            { label: `Retention${retentionRate != null ? ` (${Number(retentionRate) * 100}%)` : ''}`, value: deductionMoney(totals?.retention) },
            { label: 'Recoveries', value: signedMoney(totals?.recoveryDeductionSigned) },
            { label: `VAT${vatRate != null ? ` (${Number(vatRate) * 100}%)` : ''}`, value: formatMoneyLabel(totals?.vat) },
            { label: 'Net payment', value: formatMoneyLabel(totals?.netPayment), emphasis: true },
          ]} />
        </section>

        <section>
          <h4>Certificate position</h4>
          <MoneyRows rows={[
            { label: 'Previous certified', value: formatMoneyLabel(totals?.previousCertified) },
            { label: 'This certificate', value: formatMoneyLabel(totals?.grossWorksThisCertificate) },
            { label: 'Certified to date', value: formatMoneyLabel(totals?.certifiedToDate) },
            { label: 'Current Contract', value: formatMoneyLabel(totals?.currentContractValue) },
            { label: 'Remaining Contract', value: formatMoneyLabel(totals?.remainingContract), modifier: totals?.overCertified ? 'warning' : null },
          ]} />
        </section>

        <section>
          <h4>Commercial authority</h4>
          <MoneyRows rows={[
            { label: 'Assessment supported by prior commercial authority', value: formatMoneyLabel(facts.supportedAssessment) },
            { label: 'Unapproved certified gross', value: formatMoneyLabel(unapproved), emphasis: true, modifier: unapproved > 0 ? 'warning' : null },
          ]} />
          {unapproved > 0 ? (
            <p className="po-cert-reconcile__warning" role="status">
              {formatMoneyLabel(unapproved)} of this assessment has no prior commercial authority. Review before submitting.
            </p>
          ) : null}
        </section>
      </div>

      {retentionErrors.map((error) => <p className="po-cert-reconcile__warning" role="status" key={error}>{error}</p>)}
      {totals?.retentionRateChangeDeferred ? <p className="po-cert-reconcile__warning" role="status">The retention rate has changed. Review the current retention movement before release.</p> : null}

      <aside className="po-cert-reconcile__notice">
        <div>
          <strong>Notice and Pay Less</strong>
          <p>Notice and Pay Less requirements will be confirmed from the locked certificate and payment timetable.</p>
        </div>
        {dates ? <dl><div><dt>Due date</dt><dd>{dateLabel(dates.dueDate)}</dd></div><div><dt>Pay Less deadline</dt><dd>{dateLabel(dates.payLessNoticeDeadline)}</dd></div></dl> : null}
      </aside>

      <div className="po-cert-reconcile__edit-actions" aria-label="Edit certificate assessment">
        <button type="button" className="po-list-btn-secondary" onClick={() => onEditStage?.('application')}>Edit Application</button>
        <button type="button" className="po-list-btn-secondary" onClick={() => onEditStage?.('ordered-works')}>Edit Ordered Works</button>
        <button type="button" className="po-list-btn-secondary" onClick={() => onEditStage?.('variations')}>Edit Variations</button>
      </div>
    </section>
  );
}
