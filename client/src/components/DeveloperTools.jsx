import { useState } from 'react';
import POPageHeader from './POPageHeader';
import { buildAdminPageNavigation } from '../navigation/navigationBuilders';
import {
  BUILDLITE_BRANCH,
  BUILDLITE_VERSION,
  resetBuildLiteDemoDataFull,
} from '../developer/developerTools';

const RESET_ITEMS = [
  'Developments',
  'Plot Master',
  'Purchase Orders',
  'Subcontract Packages',
  'Order Matrices',
  'Payment Certificates',
  'Purchase Ledger Imports',
  'CVRs',
  'Import Profiles',
  'Commercial Notes',
  'Forecasts',
];

function ResetConfirmationDialog({ open, onCancel, onConfirm, busy }) {
  if (!open) return null;

  return (
    <div className="dev-tools-reset-backdrop" role="presentation">
      <div
        className="dev-tools-reset modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dev-tools-reset-title"
      >
        <h3 id="dev-tools-reset-title">Reset BuildLite Demo Data</h3>
        <p className="dev-tools-reset__lead">
          This will permanently delete all BuildLite demonstration and test data stored on
          this computer and the local development server.
        </p>
        <p className="dev-tools-reset__lead">It will remove:</p>
        <ul className="dev-tools-reset__list">
          {RESET_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="dev-tools-reset__warning">This action cannot be undone.</p>
        <div className="dev-tools-reset__actions modal-actions">
          <button
            type="button"
            className="po-list-btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="po-btn-danger"
            onClick={onConfirm}
            disabled={busy}
          >
            Reset Data
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DeveloperTools({ onBack }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirmReset() {
    setBusy(true);
    setError('');

    try {
      const result = await resetBuildLiteDemoDataFull();
      if (!result.ok) {
        setError('Reset completed but verification found remaining demo data.');
        setBusy(false);
        return;
      }

      setSuccess(true);
      setConfirmOpen(false);
      window.setTimeout(() => {
        window.location.reload();
      }, 1800);
    } catch (err) {
      setError(err?.message || 'Could not reset demo data.');
      setBusy(false);
    }
  }

  const navigation = buildAdminPageNavigation({
    pageTitle: 'Developer Tools',
    onDashboard: onBack,
  });

  return (
    <div className="dev-tools">
      <POPageHeader
        breadcrumbs={navigation.breadcrumbs}
        title="Developer Tools"
        lead="Development-only utilities for local BuildLite testing. Not available in production builds."
        onBack={onBack}
        showBack={Boolean(onBack)}
      />

      <section className="po-module-card dev-tools__panel">
        <dl className="dev-tools__meta">
          <div>
            <dt>BuildLite Version</dt>
            <dd>{BUILDLITE_VERSION}</dd>
          </div>
          <div>
            <dt>Current Branch</dt>
            <dd>{BUILDLITE_BRANCH}</dd>
          </div>
        </dl>

        <div className="dev-tools__section">
          <h2 className="po-matrix-section__title">Reset BuildLite Demo Data</h2>
          <p className="dev-tools__lead">
            Clear all commercial demonstration data from this browser and the local
            development server so you can run end-to-end tests from a clean system.
            User sign-in placeholders and UI preferences are not affected.
          </p>

          {success ? (
            <p className="dev-tools__success" role="status">
              BuildLite demo data successfully cleared. The application will now reload.
            </p>
          ) : null}

          {error ? (
            <p className="dev-tools__error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            className="po-btn-danger dev-tools__reset-btn"
            onClick={() => setConfirmOpen(true)}
            disabled={busy || success}
          >
            Reset BuildLite Demo Data
          </button>
        </div>
      </section>

      <ResetConfirmationDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmReset}
        busy={busy}
      />
    </div>
  );
}
