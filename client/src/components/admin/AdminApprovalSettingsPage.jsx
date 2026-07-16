import { getApprovalSettings } from '../../admin/approvalSettingsStore';
import AdminPageShell from './AdminPageShell';

export default function AdminApprovalSettingsPage({ onBack }) {
  const settings = getApprovalSettings();

  return (
    <AdminPageShell
      eyebrow="Administration"
      title="Approval Settings"
      lead="Future approval rules for purchase orders, payment certificates and CVRs."
      onBack={onBack}
    >
      <div className="admin-approval-grid">
        {[
          ['purchaseOrders', 'Purchase Orders'],
          ['paymentCertificates', 'Payment Certificates'],
          ['cvrs', 'CVRs'],
        ].map(([key, title]) => (
          <section key={key} className="po-module-card admin-approval-card">
            <div className="admin-approval-card__head">
              <h2>{title}</h2>
              <span className="admin-future-badge">{settings[key]?.label || 'Future Module'}</span>
            </div>
            <p>{settings[key]?.description}</p>
          </section>
        ))}
      </div>
    </AdminPageShell>
  );
}
