import { useMemo, useState } from 'react';
import POPageHeader from './POPageHeader';
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
  onOpenPeriod,
  onChanged,
}) {
  const [localRefresh, setLocalRefresh] = useState(0);

  const register = useMemo(() => {
    void refreshToken;
    void localRefresh;
    return buildCvrRegisterModel(development, { pos });
  }, [development, pos, refreshToken, localRefresh]);

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

  return (
    <div className="dev-cvr-register">
      <POPageHeader
        eyebrow="Cost Value Reconciliation"
        title={register.developmentName}
        lead={`Development ${register.developmentNumber || '—'} · Monthly CVR register`}
      />

      <header className="dev-cvr__header">
        <div>
          <h2 className="po-matrix-section__title">CVR Register</h2>
          <p className="dev-cvr__lead">
            Manage monthly CVR periods. Only one draft may exist at a time. Locked
            periods remain permanent historical records.
          </p>
        </div>
        <div className="dev-cvr__header-actions">
          <button type="button" className="po-btn-primary" onClick={handleCreatePeriod}>
            {register.draftPeriodKey ? 'Open Draft CVR' : 'Create New CVR Period'}
          </button>
        </div>
      </header>

      <div className="po-table-wrap">
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
                <td colSpan={8} className="po-data-table__empty">
                  No CVR periods yet. Create the first monthly CVR to begin the
                  commercial workflow.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
