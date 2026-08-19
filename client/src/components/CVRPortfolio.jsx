import { useEffect, useMemo, useState } from 'react';
import POPageHeader from './POPageHeader';
import SectionHeading from './layout/SectionHeading';
import { buildCvrPortfolioNavigation } from '../navigation/navigationBuilders';
import { listPOs } from '../api';
import { buildCvrPortfolioModel } from '../cvr/cvrPeriodHelpers';
import { ensureDevelopmentsReady, listDevelopments } from '../developments/developmentStore';
import {
  approveCvrPeriod,
  rejectCvrPeriod,
} from '../cvr/cvrPeriodStore';
import { isCvrServerAuthorityEnabled } from '../cvr/cvrPeriodAuthority';
import {
  ensureCvrInputsReadyForPeriod,
  ensureCvrPeriodsReadyForDevelopment,
  getCachedCvrPeriods,
} from '../cvr/cvrPeriodServerCache';

function StatusBadge({ status }) {
  if (!status) return '—';
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

function PortfolioSummary({ cards }) {
  return (
    <section className="dev-cvr__cards dev-cvr-portfolio__cards" aria-label="CVR portfolio summary">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`dev-cvr__card dev-cvr__card--${card.modifier || 'default'}`}
        >
          <span className="dev-cvr__card-label">{card.label}</span>
          <strong className="dev-cvr__card-value">{card.value}</strong>
        </div>
      ))}
    </section>
  );
}

function RejectDialog({ open, onCancel, onConfirm }) {
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!open) setComment('');
  }, [open]);

  if (!open) return null;

  return (
    <div className="dev-cvr-add-backdrop" role="presentation">
      <div className="dev-cvr-add modal" role="dialog" aria-modal="true">
        <h3>Reject CVR</h3>
        <p className="dev-cvr-add__lead">
          A comment is required when returning a submitted CVR to draft.
        </p>
        <label className="dev-form__field">
          <span className="dev-form__label">Rejection Comment</span>
          <textarea
            className="input"
            rows={4}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Explain what must be revised before resubmission."
          />
        </label>
        <div className="dev-cvr-add__actions modal-actions">
          <button type="button" className="po-list-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="po-btn-primary"
            onClick={() => onConfirm(comment)}
            disabled={!String(comment || '').trim()}
          >
            Reject to Draft
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CVRPortfolio({
  onOpenDevelopmentCvr,
  onOpenDevelopmentPeriod,
  refreshToken = 0,
}) {
  const [pos, setPos] = useState([]);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [developmentsReady, setDevelopmentsReady] = useState(false);
  const [cvrHydrated, setCvrHydrated] = useState(!isCvrServerAuthorityEnabled());
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDevelopmentsReady(false);
    setLoadError('');

    ensureDevelopmentsReady()
      .then(() => {
        if (!cancelled) {
          setDevelopmentsReady(true);
          setLoadError('');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDevelopmentsReady(false);
          setLoadError(
            error?.message ||
              'Unable to load Developments for the CVR. Please refresh and try again.'
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken, localRefresh]);

  useEffect(() => {
    if (!developmentsReady) return undefined;
    if (!isCvrServerAuthorityEnabled()) {
      setCvrHydrated(true);
      return undefined;
    }

    let cancelled = false;
    setCvrHydrated(false);

    (async () => {
      const developments = listDevelopments();
      await Promise.all(
        developments.map(async (development) => {
          try {
            await ensureCvrPeriodsReadyForDevelopment(development.id);
            const periods = getCachedCvrPeriods(development.id);
            const latest = periods[periods.length - 1];
            if (latest?.id) {
              await ensureCvrInputsReadyForPeriod(development.id, latest.id);
            }
          } catch {
            // One development failure must not collapse others to zero.
          }
        })
      );
      if (!cancelled) setCvrHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [developmentsReady, refreshToken, localRefresh]);

  useEffect(() => {
    let cancelled = false;
    listPOs()
      .then((data) => {
        if (cancelled) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        setPos(items);
      })
      .catch(() => {
        if (!cancelled) setPos([]);
      });
    return () => cancelled;
  }, [refreshToken, localRefresh]);

  const portfolio = useMemo(() => {
    void refreshToken;
    void localRefresh;
    if (!developmentsReady) return null;
    if (isCvrServerAuthorityEnabled() && !cvrHydrated) return null;
    return buildCvrPortfolioModel(pos);
  }, [pos, refreshToken, localRefresh, developmentsReady, cvrHydrated]);

  function refresh() {
    setLocalRefresh((value) => value + 1);
  }

  async function handleApprove(item) {
    const result = await Promise.resolve(approveCvrPeriod(item.developmentId, item.periodKey));
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not approve CVR.');
      return;
    }
    refresh();
  }

  async function handleReject(comment) {
    if (!rejectTarget) return;
    const result = await Promise.resolve(
      rejectCvrPeriod(rejectTarget.developmentId, rejectTarget.periodKey, comment)
    );
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not reject CVR.');
      return;
    }
    setRejectTarget(null);
    refresh();
  }

  const pageNavigation = buildCvrPortfolioNavigation();

  const pageHeader = (
    <POPageHeader
      breadcrumbs={pageNavigation.breadcrumbs}
      title={pageNavigation.title}
      lead="Monthly commercial position and approval workflow across all developments."
      showBack={false}
    />
  );

  if (loadError) {
    return (
      <div className="dev-cvr-portfolio dev-cvr-workspace">
        {pageHeader}
        <div className="po-list-feedback po-list-feedback--error" role="alert">
          {loadError}
        </div>
      </div>
    );
  }

  if (!developmentsReady || !cvrHydrated || !portfolio) {
    return (
      <div className="dev-cvr-portfolio dev-cvr-workspace">
        {pageHeader}
        <div className="po-module-card">
          <p role="status">
            {developmentsReady && isCvrServerAuthorityEnabled()
              ? 'Loading CVR data…'
              : 'Loading CVR portfolio…'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="dev-cvr-portfolio dev-cvr-workspace">
      {pageHeader}

      <PortfolioSummary cards={portfolio.summaryCards} />

      <section className="po-module-card dev-cvr-portfolio__section">
        <SectionHeading
          title="Awaiting Approval"
          support="Submitted CVR periods"
          description="Review and approve monthly commercial positions awaiting sign-off."
        />
        <div className="po-table-wrap">
          <table className="po-data-table">
            <thead>
              <tr>
                <th>Development</th>
                <th>Period</th>
                <th style={{ textAlign: 'right' }}>Forecast</th>
                <th style={{ textAlign: 'right' }}>Variance</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {portfolio.awaitingApproval.length ? (
                portfolio.awaitingApproval.map((item) => (
                  <tr key={`${item.developmentId}-${item.periodKey}`}>
                    <td>
                      <strong>{item.developmentName}</strong>
                      <div className="dev-cvr-portfolio__sub">
                        {item.developmentNumber || '—'}
                      </div>
                    </td>
                    <td>{item.periodKey}</td>
                    <td style={{ textAlign: 'right' }}>{item.forecastLabel}</td>
                    <td style={{ textAlign: 'right' }}>{item.varianceLabel}</td>
                    <td>{item.submittedLabel}</td>
                    <td>
                      <div className="dev-cvr-portfolio__actions">
                        <button
                          type="button"
                          className="po-list-btn-secondary"
                          onClick={() =>
                            onOpenDevelopmentPeriod?.(item.developmentId, item.periodKey)
                          }
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          className="po-btn-primary"
                          onClick={() => handleApprove(item)}
                        >
                          Approve &amp; Lock
                        </button>
                        <button
                          type="button"
                          className="po-list-btn-secondary"
                          onClick={() => setRejectTarget(item)}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="po-data-table__empty">
                    No submitted CVRs awaiting approval.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="po-module-card dev-cvr-portfolio__section">
        <SectionHeading
          title="Developments"
          support="Portfolio overview"
          description="Current CVR period and commercial position by development."
        />
        <div className="po-table-wrap">
          <table className="po-data-table">
            <thead>
              <tr>
                <th>Development</th>
                <th>Current Period</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Forecast</th>
                <th style={{ textAlign: 'right' }}>Variance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {portfolio.rows.length ? (
                portfolio.rows.map((row) => (
                  <tr key={row.developmentId}>
                    <td>
                      <strong>{row.developmentName}</strong>
                      <div className="dev-cvr-portfolio__sub">
                        {row.developmentNumber || '—'}
                      </div>
                    </td>
                    <td>{row.currentPeriodKey}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {row.loadState === 'error' ? 'Unable to load CVR data' : row.forecastLabel}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {row.loadState === 'error' ? '—' : row.varianceLabel}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="po-list-btn-secondary"
                        onClick={() => onOpenDevelopmentCvr?.(row.developmentId)}
                      >
                        Open CVR Register
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="po-data-table__empty">
                    No developments found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <RejectDialog
        open={Boolean(rejectTarget)}
        onCancel={() => setRejectTarget(null)}
        onConfirm={handleReject}
      />
    </div>
  );
}
