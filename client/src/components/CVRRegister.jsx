import { useEffect, useMemo, useState } from 'react';
import SectionHeading from './layout/SectionHeading';
import {
  buildCvrRegisterModel,
  createNextCvrPeriod,
  createOrOpenDraftPeriod,
} from '../cvr/cvrPeriodHelpers';

function StatusBadge({ status }) {
  if (!status) return '—';
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

export default function CVRRegister({
  development,
  pos = [],
  refreshToken = 0,
  onPrimaryActionChange = null,
  onOpenPeriod,
  onChanged,
  certificatesLoading = false,
  certificatesReady = true,
  certificatesError = '',
}) {
  const [localRefresh, setLocalRefresh] = useState(0);

  const register = useMemo(() => {
    void refreshToken;
    void localRefresh;
    void certificatesReady;
    return buildCvrRegisterModel(development, { pos });
  }, [development, pos, refreshToken, localRefresh, certificatesReady]);

  function refresh() {
    setLocalRefresh((value) => value + 1);
    onChanged?.();
  }

  function handleCreatePeriod() {
    const result = register.draftPeriodKey
      ? { ok: true, periodKey: register.draftPeriodKey, opened: true }
      : register.canCreateNext
        ? createNextCvrPeriod(development.id)
        : createOrOpenDraftPeriod(development.id);

    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not create CVR period.');
      return;
    }

    refresh();
    onOpenPeriod?.(result.periodKey);
  }

  const primaryActionLabel = register.draftPeriodKey
    ? 'Open Draft CVR'
    : 'Create New CVR Period';

  useEffect(() => {
    if (!onPrimaryActionChange) return undefined;

    onPrimaryActionChange(
      <button type="button" className="po-btn-primary" onClick={handleCreatePeriod}>
        {primaryActionLabel}
      </button>
    );

    return () => onPrimaryActionChange(null);
  }, [onPrimaryActionChange, primaryActionLabel, register.draftPeriodKey]);

  return (
    <div className="dev-cvr-register dev-cvr-workspace">
      <SectionHeading
        title="CVR Register"
        support="Monthly Commercial Reporting"
        description="Manage monthly reporting periods for this development. Only one draft may exist at a time."
      />

      {certificatesError ? (
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          Unable to load certificate data. {certificatesError}
        </div>
      ) : certificatesLoading ? (
        <p role="status">Loading certificate data…</p>
      ) : null}

      <div className="po-table-wrap dev-cvr-register__table-wrap">
        <table className="po-data-table dev-cvr-register__table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Forecast</th>
              <th style={{ textAlign: 'right' }}>Variance</th>
              <th>Created</th>
              <th>Submitted</th>
              <th>Approved</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {register.rows.length ? (
              register.rows.map((row) => (
                <tr key={row.periodKey}>
                  <td>
                    <strong>{row.periodKey}</strong>
                  </td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td style={{ textAlign: 'right' }}>{row.forecastLabel}</td>
                  <td style={{ textAlign: 'right' }}>{row.varianceLabel}</td>
                  <td>{row.createdLabel}</td>
                  <td>{row.submittedLabel}</td>
                  <td>{row.approvedLabel}</td>
                  <td>
                    <button
                      type="button"
                      className="po-list-btn-secondary"
                      onClick={() => onOpenPeriod?.(row.periodKey)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="po-empty-state__message">
                  No CVR periods yet. Create your first period to begin monthly reporting.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
