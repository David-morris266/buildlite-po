import { useMemo, useState } from 'react';
import ApplicationPageHeader from './layout/ApplicationPageHeader';
import PaymentCertificateValuationGrid from './PaymentCertificateValuationGrid';
import PaymentCertificateCommercialEvents from './PaymentCertificateCommercialEvents';
import { buildCertificateDetailNavigation } from '../navigation/navigationBuilders';
import {
  approveCertificate,
  deleteCertificate,
  getCertificate,
  getCertificateStatusMeta,
  isCertificateEditable,
  isCertificateSubmitted,
  rejectCertificate,
  submitCertificate,
  updateCertificateProgress,
} from '../payments/paymentCertificateStore';
import {
  buildCertificateAuditItems,
  buildCertificateHeaderMeta,
} from '../payments/paymentCertificateApproval';
import {
  buildCommercialSummaryItems,
  summarizeCertificateProgress,
} from '../payments/paymentCertificateProgress';
import {
  getPackageDevelopmentName,
  getPackageDisplayName,
} from '../payments/paymentCertificate';

function StatusBadge({ status }) {
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

function CertificateDialog({ title, children, confirmLabel, cancelLabel, onCancel, onConfirm, confirmClassName }) {
  return (
    <div className="po-cert-delete-backdrop" role="presentation">
      <div className="po-cert-delete modal" role="dialog" aria-modal="true">
        <h3>{title}</h3>
        {children}
        <div className="po-cert-delete__actions modal-actions">
          <button type="button" className="po-list-btn-secondary" onClick={onCancel}>
            {cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            className={confirmClassName || 'po-btn-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function CertificateAuditHistory({ items }) {
  if (!items.length) return null;

  return (
    <details className="po-cert-detail__audit" open>
      <summary>Audit History</summary>
      <ul className="po-cert-detail__audit-list">
        {items.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.label}</strong>
            <span>{entry.actor}</span>
            <span>
              {entry.dateLabel}
              {entry.timeLabel ? ` · ${entry.timeLabel}` : ''}
            </span>
            {entry.comment ? <p>{entry.comment}</p> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function PaymentCertificateDetail({
  certificateId,
  order,
  pkg,
  onBack,
  onProgressChanged,
  onDeleteRequest,
}) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [rejectComment, setRejectComment] = useState('');
  const [draftSavedAt, setDraftSavedAt] = useState(null);

  const summary = useMemo(() => {
    void refreshToken;
    return summarizeCertificateProgress(order.orderKey, certificateId, order);
  }, [order.orderKey, certificateId, refreshToken]);

  const certificate = summary?.certificate || getCertificate(order.orderKey, certificateId);
  const status = getCertificateStatusMeta(certificate?.status);
  const commercialSummary = buildCommercialSummaryItems(summary?.totals);
  const editable = isCertificateEditable(certificate);
  const submitted = isCertificateSubmitted(certificate);
  const auditItems = buildCertificateAuditItems(certificate);
  const headerMeta = buildCertificateHeaderMeta(certificate);

  if (!certificate) return null;

  function refresh() {
    setRefreshToken((value) => value + 1);
    onProgressChanged?.();
  }

  function handleProgressChange(patch) {
    updateCertificateProgress(order.orderKey, certificateId, patch);
    setDraftSavedAt(new Date().toISOString());
    refresh();
  }

  function handleSaveDraft() {
    setDraftSavedAt(new Date().toISOString());
    refresh();
  }

  function handleSubmitConfirm() {
    submitCertificate(order.orderKey, certificateId);
    setDialog(null);
    refresh();
  }

  function handleApproveConfirm() {
    approveCertificate(order.orderKey, certificateId, summary?.totals || {});
    setDialog(null);
    refresh();
  }

  function handleRejectConfirm() {
    const result = rejectCertificate(order.orderKey, certificateId, rejectComment);
    if (!result.ok) return;
    setRejectComment('');
    setDialog(null);
    refresh();
  }

  return (
    <div className="po-cert-detail">
      <ApplicationPageHeader
        breadcrumbs={buildCertificateDetailNavigation({
          certificateNumber: certificate.certificateNumber,
          packageTitle: getPackageDisplayName(order),
          onBackToPackage: onBack,
        }).breadcrumbs}
        title={`Certificate No. ${certificate.certificateNumber}`}
        lead="Payment Certificate"
        onBack={onBack}
      />

      <header className="po-module-card po-cert-detail__header">
        <div className="po-cert-detail__hero">
          <div>
            <p className="po-cert-detail__eyebrow">Payment Certificate</p>
          </div>
          <div className="po-cert-detail__status-wrap">
            <StatusBadge status={status} />
            {draftSavedAt && editable ? (
              <span className="po-cert-detail__draft-saved">
                Draft saved {new Date(draftSavedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
          </div>
        </div>

        <dl className="po-cert-detail__meta">
          <div>
            <dt>Package</dt>
            <dd>{getPackageDisplayName(order)}</dd>
          </div>
          <div>
            <dt>Supplier</dt>
            <dd>{order.supplierLabel || '—'}</dd>
          </div>
          <div>
            <dt>Development</dt>
            <dd>{getPackageDevelopmentName(order)}</dd>
          </div>
          {headerMeta.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>

        <CertificateAuditHistory items={auditItems} />
      </header>

      <div className="po-cert-detail__actions">
        {editable ? (
          <>
            <button
              type="button"
              className="po-list-btn-secondary"
              onClick={handleSaveDraft}
            >
              Save Draft
            </button>
            <button
              type="button"
              className="po-btn-primary"
              onClick={() => setDialog('submit')}
            >
              Submit for Approval
            </button>
            <button
              type="button"
              className="po-cert-workspace__link po-cert-workspace__link--danger"
              onClick={() => onDeleteRequest?.(certificate)}
            >
              Delete Draft
            </button>
            <p className="po-cert-detail__readonly-note">
              Progress saves automatically as you work. Use Save Draft to confirm your latest changes.
            </p>
          </>
        ) : null}

        {submitted ? (
          <>
            <button
              type="button"
              className="po-btn-primary"
              onClick={() => setDialog('approve')}
            >
              Approve &amp; Lock
            </button>
            <button
              type="button"
              className="po-list-btn-secondary"
              onClick={() => setDialog('reject')}
            >
              Reject
            </button>
            <p className="po-cert-detail__readonly-note">
              This certificate is submitted and read-only until approved or returned to draft.
            </p>
          </>
        ) : null}

        {!editable && !submitted ? (
          <p className="po-cert-detail__readonly-note">
            This certificate is approved and permanently locked. Values are read-only.
          </p>
        ) : null}
      </div>

      <PaymentCertificateCommercialEvents
        orderKey={order.orderKey}
        order={order}
        certificate={certificate}
        editable={editable}
        onLinesChanged={refresh}
      />

      <section
        className="po-cert-detail__sticky-summary"
        aria-label="Running commercial totals"
      >
        <h3 className="po-matrix-section__title">Commercial Summary</h3>
        <p className="po-cert-detail__summary-lead">
          Combined matrix valuation and commercial event lines. VAT uses the package PO rate on
          gross works minus retention (transitional — per-line VAT treatment deferred).
        </p>
        <dl className="po-cert-detail__commercial-grid po-cert-detail__commercial-grid--sticky">
          {commercialSummary.map((item) => (
            <div
              key={item.label}
              className={
                item.emphasis
                  ? 'po-cert-detail__commercial-item--emphasis'
                  : item.modifier
                    ? `po-cert-detail__commercial-item--${item.modifier}`
                    : undefined
              }
            >
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="po-module-card po-cert-detail__matrix">
        <h3 className="po-matrix-section__title">Valuation Matrix</h3>
        <p className="po-cert-detail__matrix-lead">
          {editable
            ? 'Click to select · double-click to open Stage Details · once open, click any cell to update the panel.'
            : 'Read-only valuation view. Approved commercial history is preserved.'}
        </p>
        <PaymentCertificateValuationGrid
          orderKey={order.orderKey}
          certificate={certificate}
          matrix={summary?.matrix}
          developmentId={order.developmentId}
          editable={editable}
          auditItems={auditItems}
          onProgressChange={handleProgressChange}
        />
      </section>

      {dialog === 'submit' ? (
        <CertificateDialog
          title={`Submit Certificate No. ${certificate.certificateNumber} for approval?`}
          confirmLabel="Submit for Approval"
          onCancel={() => setDialog(null)}
          onConfirm={handleSubmitConfirm}
        >
          <p>
            Once submitted, this certificate becomes read-only until it is approved or
            returned to draft.
          </p>
        </CertificateDialog>
      ) : null}

      {dialog === 'approve' ? (
        <CertificateDialog
          title={`Approve & lock Certificate No. ${certificate.certificateNumber}?`}
          confirmLabel="Approve & Lock"
          onCancel={() => setDialog(null)}
          onConfirm={handleApproveConfirm}
        >
          <p>
            This is the point of no return. The valuation will become the permanent
            commercial record for future certificates.
          </p>
        </CertificateDialog>
      ) : null}

      {dialog === 'reject' ? (
        <CertificateDialog
          title={`Reject Certificate No. ${certificate.certificateNumber}?`}
          confirmLabel="Return to Draft"
          confirmClassName="po-cert-delete__confirm"
          onCancel={() => {
            setRejectComment('');
            setDialog(null);
          }}
          onConfirm={handleRejectConfirm}
        >
          <p>The certificate will return to draft status and editing will be re-enabled.</p>
          <label className="po-cert-detail__reject-label" htmlFor="po-cert-reject-comment">
            Rejection comment
          </label>
          <textarea
            id="po-cert-reject-comment"
            className="input po-cert-detail__reject-comment"
            rows={3}
            value={rejectComment}
            onChange={(event) => setRejectComment(event.target.value)}
            placeholder="Explain why this certificate is being returned to draft."
          />
        </CertificateDialog>
      ) : null}
    </div>
  );
}
