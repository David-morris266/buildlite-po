import { useEffect, useState } from 'react';
import { updateCertificateMetadataOnServer } from '../payments/paymentCertificateServerMutations';

function dateLabel(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

const STATE_LABELS = {
  live: 'Live provisional timetable',
  submission: 'Submitted timetable snapshot',
  locked: 'Locked timetable snapshot',
  not_captured: 'Not captured',
};

function termsLabel(terms = {}) {
  const name = terms.familyName || null;
  const version = terms.versionLabel || null;
  const revision = terms.revisionNumber ? `Revision ${terms.revisionNumber}` : null;
  return [name, version, revision].filter(Boolean).join(' · ');
}

function friendlyReason(reason) {
  if (reason === 'Required contractual_valuation_date is unavailable.') return 'contractual valuation date required.';
  if (reason === 'Required application_received_date is unavailable.') return 'application received date required.';
  if (reason === 'Required application_valuation_date is unavailable.') return 'application valuation date required.';
  return reason;
}

export default function PaymentCertificateTimetable({ certificate, orderKey, order, onChanged }) {
  const timetable = certificate?.paymentTimetable;
  const [value, setValue] = useState(certificate?.contractualValuationDate || '');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  useEffect(() => setValue(certificate?.contractualValuationDate || ''), [certificate?.contractualValuationDate]);

  if (!timetable) return null;
  const rules = timetable.governingTermsSnapshot?.paymentRules;
  const anchorType = timetable.resolvedAnchor?.type || rules?.anchor?.type || null;
  const editableAnchor = certificate.status === 'draft' && timetable.state === 'live' && anchorType === 'contractual_valuation_date';
  const ready = timetable.readiness === 'ready' && timetable.dates;
  const reason = friendlyReason(timetable.reasons?.[0] || 'Payment timetable is unavailable.');

  async function save() {
    setBusy(true); setFeedback(null);
    try {
      const result = await updateCertificateMetadataOnServer(orderKey, certificate.id, { contractualValuationDate: value || null }, order);
      if (!result.ok) setFeedback({ type: 'error', message: result.errors?.[0] || 'Could not save the payment-cycle date.' });
      else { setFeedback({ type: 'success', message: 'Payment cycle saved.' }); onChanged?.(); }
    } finally { setBusy(false); }
  }

  return (
    <section className="po-module-card po-cert-timetable" aria-labelledby="payment-timetable-heading">
      <div className="po-cert-timetable__heading">
        <div><h3 id="payment-timetable-heading">Payment timetable</h3><p>{termsLabel(timetable.governingTermsSnapshot) || 'Governing terms unavailable'}</p></div>
        <span className="po-status-badge">{STATE_LABELS[timetable.state] || 'Payment timetable'}</span>
      </div>
      {editableAnchor ? (
        <div className="po-cert-timetable__editor">
          <label htmlFor="contractual-valuation-date">Contractual valuation date</label>
          <input id="contractual-valuation-date" className="input" type="date" value={value} onChange={(event) => setValue(event.target.value)} />
          <button type="button" className="po-list-btn-secondary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save date'}</button>
        </div>
      ) : null}
      {feedback ? <p className={`po-cert-timetable__feedback po-cert-timetable__feedback--${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.message}</p> : null}
      {ready ? (
        <dl className="po-cert-timetable__dates">
          <div><dt>{anchorType?.replaceAll('_', ' ') || 'Anchor'}</dt><dd>{dateLabel(timetable.resolvedAnchor?.value)}</dd></div>
          <div><dt>Due date</dt><dd>{dateLabel(timetable.dates.dueDate)}</dd></div>
          <div><dt>Payment Notice deadline</dt><dd>{dateLabel(timetable.dates.paymentNoticeDeadline)}</dd></div>
          <div><dt>Final date for payment</dt><dd>{dateLabel(timetable.dates.finalDateForPayment)}</dd></div>
          <div><dt>Pay Less Notice deadline</dt><dd>{dateLabel(timetable.dates.payLessNoticeDeadline)}</dd></div>
        </dl>
      ) : <p className="po-cert-timetable__unavailable">Payment deadlines unavailable — {reason}</p>}
    </section>
  );
}
