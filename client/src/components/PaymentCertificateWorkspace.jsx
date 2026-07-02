import { useMemo, useState } from 'react';
import POPageHeader from './POPageHeader';
import {
  buildCertificateDetailModel,
  buildCertificateWorkspaceModel,
  formatCertificateListRow,
  getCreateCertificateLabel,
} from '../payments/paymentCertificate';
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

function CertificateDeleteDialog({ certificate, onCancel, onConfirm }) {
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
        <p>
          This draft certificate will be removed from the package history. This
          action cannot be undone.
        </p>
        <div className="po-cert-delete__actions modal-actions">
          <button type="button" className="po-list-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="po-cert-delete__confirm" onClick={onConfirm}>
            Delete Draft
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentCertificateDetail({ certificate, order, pkg, onBack }) {
  const model = useMemo(
    () => buildCertificateDetailModel(certificate, order, pkg),
    [certificate, order, pkg]
  );

  if (!model) return null;

  return (
    <div className="po-cert-detail">
      <button type="button" className="po-cert-detail__back" onClick={onBack}>
        Back to certificates
      </button>

      <header className="po-module-card po-cert-detail__header">
        <div className="po-cert-detail__hero">
          <div>
            <p className="po-cert-detail__eyebrow">Payment Certificate</p>
            <h2 className="po-cert-detail__title">
              Certificate No. {model.certificateNumber}
            </h2>
          </div>
          <StatusBadge status={model.status} />
        </div>

        <dl className="po-cert-detail__meta">
          <div>
            <dt>Date</dt>
            <dd>{model.certificateDate}</dd>
          </div>
          <div>
            <dt>Package</dt>
            <dd>{model.packageName}</dd>
          </div>
          <div>
            <dt>Supplier</dt>
            <dd>{model.supplierLabel}</dd>
          </div>
          <div>
            <dt>Development</dt>
            <dd>{model.developmentName}</dd>
          </div>
        </dl>
      </header>

      <section className="po-module-card po-cert-detail__commercial">
        <h3 className="po-matrix-section__title">Commercial Summary</h3>
        <dl className="po-cert-detail__commercial-grid">
          {model.commercialSummary.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="po-module-card po-cert-detail__matrix">
        <h3 className="po-matrix-section__title">Valuation Matrix</h3>
        <p className="po-cert-detail__matrix-lead">
          Progress entry and automatic payment calculations will be introduced in
          the next stage of the Payment Certificate Engine.
        </p>
      </section>
    </div>
  );
}

export default function PaymentCertificateWorkspace({
  order,
  pkg,
  refreshToken = 0,
  onCertificatesChanged,
}) {
  const [selectedCertificateId, setSelectedCertificateId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const workspace = useMemo(
    () => buildCertificateWorkspaceModel(order, pkg),
    [order, pkg, refreshToken]
  );

  const certificates = useMemo(() => {
    void refreshToken;
    return listCertificates(order.orderKey).map(formatCertificateListRow);
  }, [order.orderKey, refreshToken]);

  const selectedCertificate = useMemo(() => {
    if (!selectedCertificateId) return null;
    return certificates.find((item) => item.id === selectedCertificateId) || null;
  }, [certificates, selectedCertificateId]);

  if (!workspace) return null;

  function handleCreateCertificate() {
    const result = createCertificate(order.orderKey, order);
    if (!result.ok || !result.certificate) return;
    setSelectedCertificateId(result.certificate.id);
    onCertificatesChanged?.();
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    deleteCertificate(order.orderKey, deleteTarget.id);
    if (selectedCertificateId === deleteTarget.id) {
      setSelectedCertificateId(null);
    }
    setDeleteTarget(null);
    onCertificatesChanged?.();
  }

  if (selectedCertificate) {
    return (
      <>
        <PaymentCertificateDetail
          certificate={selectedCertificate}
          order={order}
          pkg={pkg}
          onBack={() => setSelectedCertificateId(null)}
        />
        <CertificateDeleteDialog
          certificate={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
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
          <button
            type="button"
            className="po-btn-primary"
            onClick={handleCreateCertificate}
          >
            {getCreateCertificateLabel(certificates.length)}
          </button>
        ) : null}
      </header>

      {!certificates.length ? (
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
                      Open
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
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
