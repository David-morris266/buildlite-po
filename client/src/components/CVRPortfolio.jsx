import { useEffect, useMemo, useState } from 'react';
import POPageHeader from './POPageHeader';
import SectionHeading from './layout/SectionHeading';
import { buildCvrPortfolioNavigation } from '../navigation/navigationBuilders';
import { listPOs } from '../api';
import { buildCvrPortfolioModel } from '../cvr/cvrPeriodHelpers';
import { ensureDevelopmentsReady } from '../developments/developmentStore';
import {
  approveCvrPeriod,
  rejectCvrPeriod,
} from '../cvr/cvrPeriodStore';

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

  useEffect(() => {
    let cancelled = false;
    ensureDevelopmentsReady()
      .then(() => {
        if (!cancelled) setDevelopmentsReady(true);
      })
      .catch(() => {
        if (!cancelled) setDevelopmentsReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken, localRefresh]);

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
    return buildCvrPortfolioModel(pos);
  }, [pos, refreshToken, localRefresh, developmentsReady]);

  function refresh() {
    setLocalRefresh((value) => value + 1);
  }

  function handleApprove(item) {
    const result = approveCvrPeriod(item.developmentId, item.periodKey);
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not approve CVR.');
      return;
    }
    refresh();
  }

  function handleReject(comment) {
    if (!rejectTarget) return;
    const result = rejectCvrPeriod(
      rejectTarget.developmentId,
      rejectTarget.periodKey,
      comment
    );
    if (!result.ok) {
      window.alert(result.errors?.[0] || 'Could not reject CVR.');
      return;
    }
    setRejectTarget(null);
    refresh();
  }

  const pageNavigation = buildCvrPortfolioNavigation();

  return (
    <div className="dev-cvr-portfolio dev-cvr-workspace">
      <POPageHeader
        breadcrumbs={pageNavigation.breadcrumbs}
        title={pageNavigation.title}
        lead="Monthly commercial position and approval workflow across all developments."
        showBack={false}
      />

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
                    <td style={{ textAlign: 'right' }}>{row.forecastLabel}</td>
                    <td style={{ textAlign: 'right' }}>{row.varianceLabel}</td>
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
