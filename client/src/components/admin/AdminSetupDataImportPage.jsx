import { useState } from 'react';
import SetupCostCodeImportWizard from '../../setup/components/SetupCostCodeImportWizard';
import {
  formatLastRunDate,
  getCompletedSectionCount,
  getSetupPercentComplete,
  getSetupProgress,
  isSetupComplete,
  isSectionComplete,
  SETUP_SECTIONS,
} from '../../setup/setupProgressStore';
import AdminPageShell from './AdminPageShell';
import { createBreadcrumb } from '../../navigation/navigationTypes';
import { AdminButton, AdminKpiGrid } from './adminUi';

const SECTION_STEPS = {
  company: 2,
  commercialDefaults: 3,
  costCodes: 4,
  supplier: 5,
  approval: 6,
  development: 7,
  complete: 8,
};

export default function AdminSetupDataImportPage({ onBack, onLaunchSetup }) {
  const [showCostCodeImport, setShowCostCodeImport] = useState(false);
  const progress = getSetupProgress();
  const completed = getCompletedSectionCount();
  const pct = getSetupPercentComplete();

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
          onCancel={() => setShowCostCodeImport(false)}
        />
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell
      title="Setup & Data Import"
      lead="Re-run first-time setup or import master data. Existing purchase orders and CVRs are not modified."
      onBack={onBack}
    >
      <AdminKpiGrid
        items={[
          {
            label: 'Setup Status',
            value: isSetupComplete() ? 'Completed' : 'In progress',
            tone: isSetupComplete() ? 'success' : 'warning',
          },
          { label: 'Progress', value: `${completed} / ${SETUP_SECTIONS.length}` },
          { label: 'Complete', value: `${pct}%` },
          { label: 'Last Run', value: formatLastRunDate(progress.lastRunAt) },
        ]}
      />

      <section className="po-module-card admin-setup-sections">
        <h2 className="admin-panel__title">Master data import</h2>
        <div className="admin-setup-section-list">
          <article className="admin-setup-section-item">
            <div>
              <strong>Re-run Setup Assistant</strong>
              <p className="admin-page-header__lead">
                Open the guided onboarding wizard to update company, commercial and approval defaults.
              </p>
            </div>
            <AdminButton variant="primary" onClick={() => onLaunchSetup?.(1)}>
              {isSetupComplete() ? 'Re-run setup' : 'Continue setup'}
            </AdminButton>
          </article>

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

          <article className="admin-setup-section-item">
            <div>
              <strong>Import Suppliers</strong>
              <p className="admin-page-header__lead">Bulk supplier import from Excel.</p>
            </div>
            <span className="admin-chip admin-chip--muted">Coming soon</span>
          </article>

          <article className="admin-setup-section-item">
            <div>
              <strong>Import Customers</strong>
              <p className="admin-page-header__lead">Bulk client import from Excel.</p>
            </div>
            <span className="admin-chip admin-chip--muted">Coming soon</span>
          </article>
        </div>
      </section>

      <section className="po-module-card admin-setup-sections">
        <h2 className="admin-panel__title">Setup sections</h2>
        <p className="admin-page-header__lead">
          Rerun an individual onboarding section without affecting unrelated master data.
        </p>

        <div className="admin-setup-section-list">
          {SETUP_SECTIONS.map((section) => (
            <article key={section.id} className="admin-setup-section-item">
              <div>
                <strong>{section.label}</strong>
                <span className={`admin-chip ${isSectionComplete(section.id) ? 'admin-chip--success' : 'admin-chip--muted'}`}>
                  {isSectionComplete(section.id) ? 'Complete' : 'Pending'}
                </span>
              </div>
              <AdminButton
                variant="secondary"
                onClick={() => onLaunchSetup?.(SECTION_STEPS[section.id] || 1)}
              >
                {isSectionComplete(section.id) ? 'Rerun section' : 'Start section'}
              </AdminButton>
            </article>
          ))}
        </div>
      </section>
    </AdminPageShell>
  );
}
