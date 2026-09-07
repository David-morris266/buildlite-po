import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import ApplicationPageHeader from './layout/ApplicationPageHeader';
import PaymentCertificateValuationGrid from './PaymentCertificateValuationGrid';
import PaymentCertificateCommercialEvents from './PaymentCertificateCommercialEvents';
import PaymentCertificateRecoveryDeductions from './PaymentCertificateRecoveryDeductions';
import PaymentCertificateVariationOrders from './PaymentCertificateVariationOrders';
import PaymentCertificateApplication from './PaymentCertificateApplication';
import PaymentCertificateTerms from './PaymentCertificateTerms';
import PaymentCertificateTimetable from './PaymentCertificateTimetable';
import PaymentCertificateNotices from './PaymentCertificateNotices';
import PaymentCertificateDocuments from './PaymentCertificateDocuments';
import PaymentCertificateSourceAuthority from './PaymentCertificateSourceAuthority';
import PaymentCertificateVariationAssessments from './PaymentCertificateVariationAssessments';
import PaymentCertificateVariationsWorkspace from './PaymentCertificateVariationsWorkspace';
import PaymentCertificateReconcile from './PaymentCertificateReconcile';
import PaymentCertificateSubmissionReview from './PaymentCertificateSubmissionReview';
import PaymentCertificateApprovalReview from './PaymentCertificateApprovalReview';
import PaymentCertificateLockedRecord from './PaymentCertificateLockedRecord';
import { buildCertificateDetailNavigation } from '../navigation/navigationBuilders';
import {
  approveCertificate,
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
} from '../payments/paymentCertificateApproval';
import { formatMoneyLabel, summarizeCertificateProgress } from '../payments/paymentCertificateProgress';
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

function CertificateDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  onCancel,
  onConfirm,
  confirmClassName,
  confirmDisabled = false,
}) {
  const titleId = 'payment-certificate-dialog-title';
  return createPortal(
    <div className="po-cert-delete-backdrop" role="presentation">
      <div
        className="po-cert-delete modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h3 id={titleId}>{title}</h3>
        {children}
        <div className="po-cert-delete__actions modal-actions">
          <button type="button" className="po-list-btn-secondary" onClick={onCancel}>
            {cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            className={confirmClassName || 'po-btn-primary'}
            onClick={onConfirm}
            disabled={confirmDisabled}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CertificateAuditHistory({ items }) {
  if (!items.length) return null;

  return (
    <details className="po-cert-detail__audit">
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

function CertificateCommercialPosition({ totals, applicationComparison, locked }) {
  const assessedGross = totals?.grossWorksThisCertificate ?? totals?.grossThisCertificate;
  const applicationValue = applicationComparison?.comparable
    ? applicationComparison.applicationCurrentGross
    : null;
  const difference = applicationComparison?.comparable
    ? applicationComparison.difference
    : null;
  const differenceLabel = difference == null
    ? null
    : difference < 0
      ? `−${formatMoneyLabel(Math.abs(difference))}`
      : formatMoneyLabel(difference);
  const primary = [
    { label: 'Application', value: formatMoneyLabel(applicationValue) },
    { label: 'Assessment', value: formatMoneyLabel(assessedGross) },
    { label: 'Difference', value: differenceLabel || formatMoneyLabel(null) },
    { label: 'Net', value: formatMoneyLabel(totals?.netPayment) },
  ];

  return (
    <section className="po-cert-position" aria-label="Commercial position">
      <div className="po-cert-position__heading">
        <div>
          <p className="po-cert-detail__eyebrow">{locked ? 'Frozen commercial position' : 'Commercial position'}</p>
          <h3>Certificate assessment</h3>
        </div>
      </div>
      <dl className="po-cert-position__primary">
        {primary.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
      </dl>
    </section>
  );
}

const DRAFT_STAGES = [
  { id: 'application', label: 'Application' },
  { id: 'ordered-works', label: 'Ordered Works' },
  { id: 'variations', label: 'Variations' },
  { id: 'reconcile', label: 'Reconcile' },
  { id: 'release', label: 'Submit' },
];

// eslint-disable-next-line react-refresh/only-export-components
export function resolveCertificatePackageId(certificate, pkg, order) {
  return (
    certificate?.packageUuid ||
    certificate?.packageId ||
    pkg?.id ||
    order?.packageUuid ||
    order?.packageId ||
    null
  );
}

export default function PaymentCertificateDetail({
  certificateId,
  order,
  pkg,
  developmentName = null,
  onBack,
  onProgressChanged,
  onDeleteRequest,
}) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [rejectComment, setRejectComment] = useState('');
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const [workflowFeedback, setWorkflowFeedback] = useState(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [applicationComparison, setApplicationComparison] = useState(null);
  const [activeStage, setActiveStage] = useState('application');

  const summary = useMemo(() => {
    void refreshToken;
    return summarizeCertificateProgress(order.orderKey, certificateId, order);
  }, [order, certificateId, refreshToken, pkg?.matrixLoadState, pkg?.matrixReady]);

  const certificate = summary?.certificate || getCertificate(order.orderKey, certificateId, order);
  const authoritativePackageId = resolveCertificatePackageId(certificate, pkg, order);
  const certificatesPending = pkg?.certificatesReady === false;
  const status = getCertificateStatusMeta(certificate?.status);
  const matrixReady = summary?.matrixReady !== false;
  const editable = isCertificateEditable(certificate) && matrixReady && !certificatesPending;
  const submitted = isCertificateSubmitted(certificate) && !certificatesPending;
  const auditItems = buildCertificateAuditItems(certificate);
  const locked = String(certificate?.status || '').toLowerCase() === 'locked';
  const lockedApplicationComparison = certificate?.lockedApplicationSnapshot?.comparison;
  const submittedApplicationComparison = certificate?.submissionApplicationSnapshot?.comparison;

  useEffect(() => {
    const frozen = locked
      ? lockedApplicationComparison
      : String(certificate?.status || '').toLowerCase() === 'submitted'
        ? submittedApplicationComparison
        : null;
    setApplicationComparison(frozen || null);
  }, [certificate?.id, certificate?.version, certificate?.status, locked, lockedApplicationComparison, submittedApplicationComparison]);

  const handleApplicationComparisonChanged = useCallback((comparison) => {
    setApplicationComparison(comparison || null);
  }, []);

  if (certificatesPending) {
    return (
      <div className="po-cert-detail" role="status">
        <p>Loading certificate data…</p>
      </div>
    );
  }

  if (!certificate) return null;

  function refresh() {
    setRefreshToken((value) => value + 1);
    onProgressChanged?.();
  }

  function handleProgressChange(patch) {
    return Promise.resolve(
      updateCertificateProgress(order.orderKey, certificateId, patch, order, {
        matrix: summary?.matrix,
      })
    )
      .then((result) => {
        if (!result?.ok) {
          setWorkflowFeedback({
            type: 'error',
            message: result?.errors?.[0] || 'Could not save certificate progress.',
          });
        } else {
          setDraftSavedAt(new Date().toISOString());
          setWorkflowFeedback(null);
        }
        refresh();
        return result;
      })
      .catch((error) => {
        const message = error?.message || 'Could not save certificate progress.';
        setWorkflowFeedback({
          type: 'error',
          message,
        });
        refresh();
        return { ok: false, errors: [message] };
      });
  }

  function handleSaveDraft() {
    setDraftSavedAt(new Date().toISOString());
    refresh();
  }

  async function handleSubmitConfirm() {
    if (lifecycleBusy) return;
    setLifecycleBusy(true);
    try {
      const result = await Promise.resolve(
        submitCertificate(order.orderKey, certificateId, order)
      );
      if (!result.ok) {
        setWorkflowFeedback({
          type: 'error',
          message: result.errors?.[0] || 'Could not submit certificate.',
        });
        return;
      }

      setWorkflowFeedback(null);
      setDialog(null);
      refresh();
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function handleApproveConfirm() {
    if (lifecycleBusy) return;
    setLifecycleBusy(true);
    try {
      const result = await Promise.resolve(
        approveCertificate(order.orderKey, certificateId, summary?.totals || {}, order)
      );

      if (!result.ok) {
        setWorkflowFeedback({
          type: 'error',
          message: result.errors?.[0] || 'Could not approve certificate.',
        });
        return;
      }

      setWorkflowFeedback(null);
      setDialog(null);
      refresh();
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function handleRejectConfirm() {
    if (lifecycleBusy) return;
    setLifecycleBusy(true);
    try {
      const result = await Promise.resolve(
        rejectCertificate(order.orderKey, certificateId, rejectComment, order)
      );
      if (!result.ok) {
        setWorkflowFeedback({
          type: 'error',
          message: result.errors?.[0] || 'Could not return certificate to Draft.',
        });
        return;
      }
      setRejectComment('');
      setWorkflowFeedback(null);
      setDialog(null);
      refresh();
    } finally {
      setLifecycleBusy(false);
    }
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
        lead={`${developmentName || getPackageDevelopmentName(order)} · ${getPackageDisplayName(order)} · ${order.supplierLabel || 'Supplier not recorded'}`}
        onBack={onBack}
        backLabel="Back to Certificates"
        actions={<StatusBadge status={status} />}
      />

      {draftSavedAt && editable ? (
        <p className="po-cert-detail__draft-saved po-cert-detail__draft-saved--standalone">
          Draft saved {new Date(draftSavedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </p>
      ) : null}

      {editable ? <CertificateCommercialPosition
        totals={summary?.totals}
        applicationComparison={applicationComparison}
        locked={locked}
      /> : null}

      {editable ? (
        <nav className="po-cert-stages" aria-label="Certificate assessment stages">
          {DRAFT_STAGES.map((stage, index) => (
            <button
              key={stage.id}
              type="button"
              className={`po-cert-stages__tab${activeStage === stage.id ? ' po-cert-stages__tab--active' : ''}`}
              aria-current={activeStage === stage.id ? 'step' : undefined}
              onClick={() => setActiveStage(stage.id)}
            >
              <span>{index + 1}</span>{stage.label}
            </button>
          ))}
        </nav>
      ) : null}

      {!['reconcile', 'release'].includes(activeStage) && Number(certificate?.sourceAuthority?.unapprovedCertifiedGross || 0) !== 0 ? (
        <div className="po-list-feedback po-list-feedback--warning po-cert-detail__authority-alert" role="status">
          {formatMoneyLabel(certificate.sourceAuthority.unapprovedCertifiedGross)} of this assessment has no prior commercial authority. Review before submitting.
        </div>
      ) : null}

      {workflowFeedback?.type === 'error' && !dialog ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {workflowFeedback.message}
        </div>
      ) : null}

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
            {!certificate.hasSubmissionHistory ? (
              <button
                type="button"
                className="po-cert-workspace__link po-cert-workspace__link--danger"
                onClick={() => onDeleteRequest?.(certificate)}
              >
                Delete Draft
              </button>
            ) : null}
            <p className="po-cert-detail__readonly-note">
              Progress saves automatically as you work. Use Save Draft to confirm your latest changes.
            </p>
          </>
        ) : null}

      </div>

      {editable ? <div hidden={activeStage !== 'application'}>
        <PaymentCertificateApplication
          packageId={authoritativePackageId}
          certificate={certificate}
          assessmentGross={summary?.totals?.grossWorksThisCertificate ?? certificate.grossValue}
          editable={editable}
          onChanged={refresh}
          onComparisonChanged={handleApplicationComparisonChanged}
        />
      </div> : null}

      {editable ? (
        <section className="po-module-card po-cert-detail__matrix" hidden={editable && activeStage !== 'ordered-works'}>
          <h3 className="po-matrix-section__title">Valuation Matrix</h3>
          <p className="po-cert-detail__matrix-lead">
            Click to select · double-click to open Stage Details · once open, click any cell to update the panel.
          </p>
          <PaymentCertificateValuationGrid
            orderKey={order.orderKey}
            certificate={certificate}
            matrix={summary?.matrix}
            valuationGrid={summary?.fromValuationSnapshot ? summary.grid : null}
            developmentId={order.developmentId}
            editable={editable && summary?.matrixReady !== false}
            auditItems={auditItems}
            matrixReady={summary?.matrixReady !== false}
            matrixLoadState={summary?.matrixLoadState || 'loaded'}
            matrixError={summary?.matrixError || null}
            onProgressChange={handleProgressChange}
          />
        </section>
      ) : null}

      {editable ? (
        <div hidden={activeStage !== 'variations'}>
          <PaymentCertificateVariationsWorkspace
            packageId={authoritativePackageId}
            certificate={certificate}
            editable={editable}
            onChanged={refresh}
          />
        </div>
      ) : null}

      {editable && activeStage === 'reconcile' ? (
        <PaymentCertificateReconcile
          certificate={certificate}
          totals={summary?.totals}
          applicationComparison={applicationComparison}
          onEditStage={setActiveStage}
        />
      ) : null}

      {editable && activeStage === 'release' ? (
        <PaymentCertificateSubmissionReview
          certificate={certificate}
          totals={summary?.totals}
          applicationComparison={applicationComparison}
          onEditStage={setActiveStage}
          onSubmit={() => {
            setWorkflowFeedback(null);
            setDialog('submit');
          }}
          busy={lifecycleBusy}
        />
      ) : null}

      {submitted ? (
        <PaymentCertificateApprovalReview
          certificate={certificate}
          totals={summary?.totals}
          applicationComparison={applicationComparison}
          auditItems={auditItems}
          onApprove={() => {
            setWorkflowFeedback(null);
            setDialog('approve');
          }}
          onReturnToDraft={() => {
            setWorkflowFeedback(null);
            setDialog('reject');
          }}
          busy={lifecycleBusy}
          approveDisabled={summary?.matrixReady === false}
          valuationDetail={(
            <section className="po-cert-approval__valuation">
              <h3>Ordered Works valuation detail</h3>
              <p>Read-only submitted valuation evidence. Approval will recalculate and revalidate these values before Lock.</p>
              <PaymentCertificateValuationGrid
                orderKey={order.orderKey}
                certificate={certificate}
                matrix={summary?.matrix}
                valuationGrid={summary?.fromValuationSnapshot ? summary.grid : null}
                developmentId={order.developmentId}
                editable={false}
                auditItems={auditItems}
                matrixReady={summary?.matrixReady !== false}
                matrixLoadState={summary?.matrixLoadState || 'loaded'}
                matrixError={summary?.matrixError || null}
                onProgressChange={handleProgressChange}
              />
            </section>
          )}
        />
      ) : null}

      {locked ? (
        <PaymentCertificateLockedRecord
          certificate={certificate}
          totals={summary?.totals}
          applicationComparison={applicationComparison}
          supportingDetail={(
            <div className="po-cert-locked__supporting-grid">
              <PaymentCertificateApplication
                packageId={authoritativePackageId}
                certificate={certificate}
                assessmentGross={summary?.totals?.grossWorksThisCertificate ?? certificate.grossValue}
                editable={false}
                onChanged={refresh}
                onComparisonChanged={handleApplicationComparisonChanged}
              />
              <PaymentCertificateVariationAssessments packageId={authoritativePackageId} certificate={certificate} editable={false} onChanged={refresh} />
              <PaymentCertificateCommercialEvents orderKey={order.orderKey} order={order} certificate={certificate} editable={false} onLinesChanged={refresh}>
                <PaymentCertificateVariationOrders packageId={authoritativePackageId} orderKey={order.orderKey} order={order} certificate={certificate} editable={false} onLinesChanged={refresh} />
              </PaymentCertificateCommercialEvents>
              <PaymentCertificateRecoveryDeductions orderKey={order.orderKey} order={order} certificate={certificate} editable={false} onLinesChanged={refresh} />
              <PaymentCertificateSourceAuthority certificate={certificate} />
              <PaymentCertificateTerms certificate={certificate} governingTerms={pkg?.governingTerms} />
              <PaymentCertificateTimetable certificate={certificate} orderKey={order.orderKey} order={order} onChanged={refresh} />
              <section className="po-module-card po-cert-detail__matrix">
                <h3 className="po-matrix-section__title">Frozen Valuation Detail</h3>
                <p className="po-cert-detail__matrix-lead">Read-only valuation evidence preserved at Lock.</p>
                <PaymentCertificateValuationGrid orderKey={order.orderKey} certificate={certificate} matrix={summary?.matrix} valuationGrid={summary?.fromValuationSnapshot ? summary.grid : null} developmentId={order.developmentId} editable={false} auditItems={auditItems} matrixReady={summary?.matrixReady !== false} matrixLoadState={summary?.matrixLoadState || 'loaded'} matrixError={summary?.matrixError || null} onProgressChange={handleProgressChange} />
              </section>
              <section className="po-module-card po-cert-detail__supporting-evidence">
                <h3 className="po-matrix-section__title">Audit &amp; supporting evidence</h3>
                <CertificateAuditHistory items={auditItems} />
              </section>
            </div>
          )}
          noticeAndDocuments={(
            <>
              <PaymentCertificateNotices certificate={certificate} packageId={authoritativePackageId} />
              <PaymentCertificateDocuments certificate={certificate} packageId={authoritativePackageId} />
            </>
          )}
        />
      ) : null}

      {dialog === 'submit' ? (
        <CertificateDialog
          title="Submit Payment Certificate for Approval?"
          confirmLabel="Submit for Approval"
          onCancel={() => {
            setWorkflowFeedback(null);
            setDialog(null);
          }}
          onConfirm={handleSubmitConfirm}
          confirmDisabled={lifecycleBusy}
        >
          {workflowFeedback?.type === 'error' ? (
            <div className="po-list-feedback po-list-feedback--error" role="alert">
              {workflowFeedback.message}
            </div>
          ) : null}
          <p>
            Submit the current certificate for approval. It will become read-only until
            approved or returned to Draft. Final financial and source-authority evidence
            is frozen when the certificate is approved and locked.
          </p>
        </CertificateDialog>
      ) : null}

      {dialog === 'approve' ? (
        <CertificateDialog
          title={`Approve & lock Certificate No. ${certificate.certificateNumber}?`}
          confirmLabel="Approve & Lock"
          onCancel={() => {
            setWorkflowFeedback(null);
            setDialog(null);
          }}
          onConfirm={handleApproveConfirm}
          confirmDisabled={lifecycleBusy}
        >
          {workflowFeedback?.type === 'error' ? (
            <div className="po-list-feedback po-list-feedback--error" role="alert">
              {workflowFeedback.message}
            </div>
          ) : null}
          <p>
            This is the point of no return. The valuation will become the permanent
            commercial record for future certificates.
          </p>
        </CertificateDialog>
      ) : null}

      {dialog === 'reject' ? (
        <CertificateDialog
          title={`Return Certificate No. ${certificate.certificateNumber} to Draft?`}
          confirmLabel="Return to Draft"
          confirmClassName="po-cert-delete__confirm"
          onCancel={() => {
            setRejectComment('');
            setWorkflowFeedback(null);
            setDialog(null);
          }}
          onConfirm={handleRejectConfirm}
          confirmDisabled={lifecycleBusy || !rejectComment.trim()}
        >
          {workflowFeedback?.type === 'error' ? (
            <div className="po-list-feedback po-list-feedback--error" role="alert">
              {workflowFeedback.message}
            </div>
          ) : null}
          <p>The certificate will return to draft status and editing will be re-enabled.</p>
          <label className="po-cert-detail__reject-label" htmlFor="po-cert-reject-comment">
            Return-to-Draft reason
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
