import { useEffect, useMemo, useState } from 'react';
import { listPOs } from '../../api';
import { runMasterDataValidation } from '../../admin/masterDataValidation';
import {loadCommercialStructure} from '../../admin/commercialStructureService';
import {ensureAdminCostCodesReady,listAdminCostCodeRecords} from '../../admin/costCodeAdminService';
import AdminPageShell from './AdminPageShell';
import { AdminButton, AdminKpiGrid, AdminSkeleton } from './adminUi';

const ISSUE_LINKS = {
  'unresolved-hierarchy': 'cost-codes',
  'invalid-hierarchy': 'cost-codes',
  'duplicate-codes': 'cost-codes',
  'inactive-in-use': 'cost-codes',
  'unused-trades': 'commercial-structure',
  'unused-families': 'commercial-structure',
};

function severityMeta(severity) {
  if (severity === 'error') {
    return { icon: '✕', tone: 'critical', label: 'Critical' };
  }
  if (severity === 'warning') {
    return { icon: '⚠', tone: 'warning', label: 'Warning' };
  }
  return { icon: '✓', tone: 'healthy', label: 'Info' };
}

function computeHealthScore(issues = []) {
  const critical = issues.filter((item) => item.severity === 'error').length;
  const warnings = issues.filter((item) => item.severity === 'warning').length;
  return Math.max(0, 100 - critical * 20 - warnings * 8);
}

export default function AdminValidationDashboardPage({ onBack, onNavigate }) {
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError,setLoadError]=useState('');
  const [authority,setAuthority]=useState({structure:{heads:[],families:[],reportingGroups:[]},records:[]});

  useEffect(() => {
    Promise.all([listPOs({ pageSize: 500 }),loadCommercialStructure(),ensureAdminCostCodesReady()])
      .then(([data,structure]) => {
        const records=listAdminCostCodeRecords();if(records==null)throw new Error('Cost Code Master is unavailable.');
        setPurchaseOrders(Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []);
        setAuthority({structure,records});
      })
      .catch(error => setLoadError(error?.message || 'BuildLite could not load authoritative master data.'))
      .finally(() => setLoading(false));
  }, []);

  const report = useMemo(
    () => runMasterDataValidation({ purchaseOrders,...authority }),
    [purchaseOrders,authority]
  );

  const healthScore = computeHealthScore(report.issues);
  const criticalCount = report.issues.filter((item) => item.severity === 'error').length;
  const warningCount = report.issues.filter((item) => item.severity === 'warning').length;
  const healthyCount = report.issues.filter((item) => item.severity === 'info').length;

  return (
    <AdminPageShell
      title="Validation Dashboard"
      lead="BuildLite master data health check — surface gaps before they affect commercial reporting."
      onBack={onBack}
    >
      {loading ? <AdminSkeleton rows={3} /> : null}
      {!loading && loadError ? <p className="admin-inline-warning" role="alert">{loadError}</p> : null}

      {!loading && !loadError ? (
        <>
          <section className="admin-health-hero po-module-card">
            <div className="admin-health-hero__score">
              <span className="admin-health-hero__value">{healthScore}%</span>
              <span className="admin-health-hero__label">
                {report.healthy ? 'Healthy' : 'Review Required'}
              </span>
            </div>
            <p className="admin-health-hero__copy">
              Overall master data health based on critical issues and warnings across BuildLite administration records.
            </p>
          </section>

          <AdminKpiGrid
            items={[
              { label: 'Issues Found', value: report.issues.length },
              { label: 'Critical', value: criticalCount, tone: criticalCount ? 'alert' : 'success' },
              { label: 'Warnings', value: warningCount, tone: warningCount ? 'warning' : 'success' },
              { label: 'Healthy', value: healthyCount, tone: 'success' },
            ]}
          />

          <div className="admin-validation-grid">
            {report.issues.length ? report.issues.map((issue) => {
              const meta = severityMeta(issue.severity);
              const linkTarget = ISSUE_LINKS[issue.id];

              return (
                <article
                  key={issue.id}
                  className={`po-module-card admin-validation-card admin-validation-card--${meta.tone}`}
                >
                  <header className="admin-validation-card__head">
                    <div className="admin-validation-card__title-wrap">
                      <span className="admin-validation-card__icon" aria-hidden="true">{meta.icon}</span>
                      <div>
                        <h2>{issue.title}</h2>
                        <span className="admin-validation-card__severity">{meta.label}</span>
                      </div>
                    </div>
                    <span className="admin-validation-card__count">{issue.count}</span>
                  </header>
                  <p>{issue.detail}</p>
                  {linkTarget && onNavigate ? (
                    <AdminButton variant="secondary" onClick={() => onNavigate(linkTarget, {
                      issueId: issue.id,
                      label: issue.title,
                      records: issue.affectedRecords || [],
                    })}>
                      Review affected records
                    </AdminButton>
                  ) : null}
                </article>
              );
            }) : (
              <article className="po-module-card admin-validation-card admin-validation-card--healthy">
                <header className="admin-validation-card__head">
                  <div className="admin-validation-card__title-wrap">
                    <span className="admin-validation-card__icon" aria-hidden="true">✓</span>
                    <div>
                      <h2>All checks passed</h2>
                      <span className="admin-validation-card__severity">Healthy</span>
                    </div>
                  </div>
                </header>
                <p>No master data issues were detected.</p>
              </article>
            )}
          </div>
        </>
      ) : null}
    </AdminPageShell>
  );
}
