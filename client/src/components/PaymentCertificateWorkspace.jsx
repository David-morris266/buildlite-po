import { useEffect, useMemo, useState } from 'react';
import POPageHeader from './POPageHeader';
import PaymentCertificateDetail from './PaymentCertificateDetail';
import {
  buildCertificateWorkspaceModel,
  formatCertificateListRow,
} from '../payments/paymentCertificate';
import { getCreateCertificateState } from '../payments/paymentCertificateApproval';
import {
  createCertificate,
  deleteCertificate,
  listCertificates,
} from '../payments/paymentCertificateStore';

function StatusBadge({ status }) {
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

function CertificateSummaryDashboard({ cards, status }) {
  return (
    <section
      className="po-cert-workspace__cards"
      aria-label="Certificate workspace summary"
    >
      {cards.map((card) => (
        <div
          key={card.label}
          className={`po-cert-workspace__card po-cert-workspace__card--${card.modifier}`}
        >
          <span className="po-cert-workspace__card-label">{card.label}</span>
          {card.isBadge ? (
            <StatusBadge status={status || card.status} />
          ) : (
            <strong className="po-cert-workspace__card-value">{card.value}</strong>
          )}
        </div>
      ))}
    </section>
  );
}

function CertificateDeleteDialog({ certificate, errorMessage, busy, onCancel, onConfirm }) {
  if (!certificate) return null;

  return (
    <div className="po-cert-delete-backdrop" role="presentation">
      <div
        className="po-cert-delete modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="po-cert-delete-title"
      >
        <h3 id="po-cert-delete-title">
          Delete Certificate No. {certificate.certificateNumber}?
        </h3>
        {errorMessage ? (
          <div className="po-list-feedback po-list-feedback--error" role="alert">
            {errorMessage}
          </div>
        ) : null}
        <p>
          This draft certificate will be removed from the package history. This
          action cannot be undone.
        </p>
        <div className="po-cert-delete__actions modal-actions">
          <button type="button" className="po-list-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="po-cert-delete__confirm"
            onClick={onConfirm}
            disabled={busy}
          >
            Delete Draft
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PaymentCertificateWorkspace({
  order,
  pkg,
  refreshToken = 0,
  certificateTarget = null,
  onCertificatesChanged,
  certificatesLoading = false,
  certificatesReady = true,
  certificatesError = '',
  onDetailModeChange,
}) {
  const [selectedCertificateId, setSelectedCertificateId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const certificatesPending =
    certificatesLoading || certificatesReady === false || pkg?.certificatesReady === false;

  const workspace = useMemo(
    () => buildCertificateWorkspaceModel(order, pkg),
    [order, pkg, refreshToken, certificatesPending]
  );

  const certificates = useMemo(() => {
    void refreshToken;
    if (certificatesPending) return [];
    return listCertificates(order.orderKey, order).map((certificate) =>
      formatCertificateListRow(certificate, order.orderKey, order)
    );
  }, [order, order.orderKey, refreshToken, certificatesPending]);

  const createState = useMemo(
    () => getCreateCertificateState(order.orderKey, certificates.length, order),
    [order, order.orderKey, certificates.length, refreshToken, certificatesPending]
  );

  useEffect(() => {
    if (certificateTarget?.certificateId) {
      setSelectedCertificateId(certificateTarget.certificateId);
    }
  }, [certificateTarget?.certificateId, certificateTarget?.navigationKey]);

  useEffect(() => {
    onDetailModeChange?.(Boolean(selectedCertificateId));
    return () => onDetailModeChange?.(false);
  }, [selectedCertificateId, onDetailModeChange]);

  if (!workspace) return null;

  async function handleCreateCertificate() {
    if (pkg?.matrixReady === false) return;
    if (certificatesPending) return;
    if (!createState.ok) return;
    if (createBusy) return;
    setCreateBusy(true);
    setMutationError('');
    try {
      const result = await Promise.resolve(createCertificate(order.orderKey, order));
      if (!result.ok || !result.certificate) {
        setMutationError(result.errors?.[0] || 'Could not create certificate.');
        return;
      }
      setSelectedCertificateId(result.certificate.id);
      onCertificatesChanged?.();
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setMutationError('');
    try {
      const result = await Promise.resolve(
        deleteCertificate(order.orderKey, deleteTarget.id, order)
      );
      if (!result?.ok) {
        setMutationError(result?.errors?.[0] || 'Could not delete certificate.');
        return;
      }
      if (selectedCertificateId === deleteTarget.id) {
        setSelectedCertificateId(null);
      }
      setDeleteTarget(null);
      onCertificatesChanged?.();
    } finally {
      setDeleteBusy(false);
    }
  }

  if (selectedCertificateId && !certificatesPending) {
    return (
      <>
        <PaymentCertificateDetail
          certificateId={selectedCertificateId}
          order={order}
          pkg={pkg}
          onBack={() => setSelectedCertificateId(null)}
          onProgressChanged={onCertificatesChanged}
          onDeleteRequest={setDeleteTarget}
        />
        <CertificateDeleteDialog
          certificate={deleteTarget}
          errorMessage={mutationError}
          busy={deleteBusy}
          onCancel={() => {
            setDeleteTarget(null);
            setMutationError('');
          }}
          onConfirm={handleDeleteConfirm}
        />
      </>
    );
  }

  return (
    <div className="po-cert-workspace">
      <POPageHeader
        eyebrow="Certificate Workspace"
        title={workspace.packageName}
        lead={`${workspace.supplierLabel} · ${workspace.developmentName}`}
      />

      <div className="po-cert-workspace__meta">
        <StatusBadge status={workspace.status} />
      </div>

      <CertificateSummaryDashboard
        cards={workspace.summaryCards}
        status={workspace.status}
      />

      <header className="po-cert-workspace__list-header">
        <div>
          <h2 className="po-matrix-section__title">Payment Certificates</h2>
          <p className="po-cert-workspace__list-lead">
            Commercial history for this subcontract package.
          </p>
        </div>
        {certificates.length ? (
          <div className="po-cert-workspace__create-wrap">
            <button
              type="button"
              className="po-btn-primary"
              onClick={handleCreateCertificate}
              disabled={!createState.ok || pkg?.matrixReady === false || certificatesPending || createBusy}
            >
              {createState.label}
            </button>
            {!createState.ok ? (
              <p className="po-cert-workspace__create-hint">{createState.reason}</p>
            ) : mutationError ? (
              <p className="po-cert-workspace__create-hint" role="alert">{mutationError}</p>
            ) : null}
          </div>
        ) : null}
      </header>

      {certificatesError ? (
        <div className="po-module-card po-empty-state po-cert-workspace__empty" role="alert">
          <p className="po-empty-state__message">Unable to load certificate data.</p>
          <p className="po-empty-state__hint">
            {certificatesError}
          </p>
        </div>
      ) : certificatesPending ? (
        <div className="po-module-card po-empty-state po-cert-workspace__empty" role="status">
          <p className="po-empty-state__message">Loading certificate data…</p>
        </div>
      ) : !certificates.length ? (
        <div className="po-module-card po-empty-state po-cert-workspace__empty">
          <p className="po-empty-state__message">
            No Payment Certificates have been created.
          </p>
          <p className="po-empty-state__hint">
            Create your first Payment Certificate to begin recording commercial
            progress against this subcontract package.
          </p>
          <button
            type="button"
            className="po-btn-primary"
            onClick={handleCreateCertificate}
            disabled={
              !createState.ok ||
              pkg?.matrixReady === false ||
              certificatesPending ||
              createBusy
            }
          >
            Create Certificate No. 1
          </button>
        </div>
      ) : (
        <div className="po-table-wrap">
          <table className="po-data-table po-cert-workspace__table">
            <thead>
              <tr>
                <th>Certificate No.</th>
                <th>Date</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Gross Value</th>
                <th style={{ textAlign: 'right' }}>Net Value</th>
                <th>Approved By</th>
                <th className="po-cert-workspace__actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {certificates.map((certificate) => (
                <tr key={certificate.id}>
                  <td>{certificate.certificateNumber}</td>
                  <td>{certificate.dateLabel}</td>
                  <td>
                    <StatusBadge status={certificate.statusMeta} />
                  </td>
                  <td style={{ textAlign: 'right' }}>{certificate.grossLabel}</td>
                  <td style={{ textAlign: 'right' }}>{certificate.netLabel}</td>
                  <td>{certificate.approvedByLabel}</td>
                  <td className="po-cert-workspace__row-actions">
                    <button
                      type="button"
                      className="po-cert-workspace__link"
                      onClick={() => setSelectedCertificateId(certificate.id)}
                    >
                      {certificate.listAction.label}
                    </button>
                    {certificate.canDelete ? (
                      <button
                        type="button"
                        className="po-cert-workspace__link po-cert-workspace__link--danger"
                        onClick={() => setDeleteTarget(certificate)}
                      >
                        Delete Draft
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CertificateDeleteDialog
        certificate={deleteTarget}
        errorMessage={mutationError}
        busy={deleteBusy}
        onCancel={() => {
          setDeleteTarget(null);
          setMutationError('');
        }}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
