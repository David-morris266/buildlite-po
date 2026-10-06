import { useState } from 'react';
import SetupCostCodeImportWizard from '../../setup/components/SetupCostCodeImportWizard';
import AdminPageShell from './AdminPageShell';
import { createBreadcrumb } from '../../navigation/navigationTypes';
import { AdminButton } from './adminUi';

export default function AdminSetupDataImportPage({ onBack, initialCostCodeImport = false, onReviewCostCodeHierarchy }) {
  const [showCostCodeImport, setShowCostCodeImport] = useState(initialCostCodeImport);

  if (showCostCodeImport) {
    return (
      <AdminPageShell
        title="Import Cost Codes"
        lead="Upload Excel or CSV to add or update master cost codes."
        breadcrumbs={[
          createBreadcrumb('Administration', onBack),
          createBreadcrumb('Setup & Data Import', () => setShowCostCodeImport(false)),
          createBreadcrumb('Import Cost Codes'),
        ]}
        onBack={() => setShowCostCodeImport(false)}
      >
        <SetupCostCodeImportWizard
          onComplete={() => setShowCostCodeImport(false)}
          onReviewCostCodeHierarchy={onReviewCostCodeHierarchy}
          onCancel={() => setShowCostCodeImport(false)}
        />
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell
      title="Setup & Data Import"
      lead="Import authoritative company master data. Existing purchase orders and CVRs are not modified."
      onBack={onBack}
    >
      <section className="po-module-card admin-setup-sections">
        <h2 className="admin-panel__title">Master data import</h2>
        <div className="admin-setup-section-list">
          <article className="admin-setup-section-item">
            <div>
              <strong>Import Cost Codes</strong>
              <p className="admin-page-header__lead">
                Upload Excel or CSV with cost code, description and optional commercial hierarchy fields.
              </p>
            </div>
            <AdminButton variant="secondary" onClick={() => setShowCostCodeImport(true)}>
              Import cost codes
            </AdminButton>
          </article>

        </div>
      </section>

    </AdminPageShell>
  );
}
