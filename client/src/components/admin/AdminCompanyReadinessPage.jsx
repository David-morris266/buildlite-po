import { useCallback, useEffect, useState } from 'react';
import { useBuildLitePrincipal } from '../../auth/BuildLiteAuthProvider';
import AdminPageShell from './AdminPageShell';
import { AdminButton, AdminKpiGrid } from './adminUi';

function ReadinessItem({ title, status, detail, action, onAction, tone = 'warning' }) {
  return <article className="po-module-card admin-readiness-item">
    <div className="admin-panel__heading"><div><h2>{title}</h2><p>{detail}</p></div><span className={`admin-chip admin-chip--${tone}`}>{status}</span></div>
    {action ? <AdminButton variant="secondary" onClick={onAction}>{action}</AdminButton> : null}
  </article>;
}

export default function AdminCompanyReadinessPage({ onOpen, onOpenDevelopments }) {
  const principal = useBuildLitePrincipal();
  const refreshTenantReadiness = principal?.refreshTenantReadiness;
  const freshness = principal?.readinessFreshness || { state: principal?.tenantReadiness ? 'fresh' : 'loading' };
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const refresh = useCallback(async () => {
    if (!refreshTenantReadiness) return;
    setRefreshing(true); setRefreshError('');
    try { await refreshTenantReadiness(); }
    catch (error) { setRefreshError(error.message || 'Company readiness could not be refreshed.'); }
    finally { setRefreshing(false); }
  }, [refreshTenantReadiness]);
  const sameTenant = !freshness.clientId || String(freshness.clientId) === String(principal?.activeTenant?.clientId);
  useEffect(() => { if (freshness.state === 'stale' || !sameTenant) refresh(); }, [freshness.state, sameTenant, refresh]);
  const authoritative = sameTenant && freshness.hasAuthoritativeData !== false && (freshness.state === 'fresh' || freshness.state === 'refreshing' || freshness.state === 'error');
  const readiness = authoritative ? principal?.tenantReadiness : null;
  const counts = readiness?.counts;
  const tenantName = readiness?.tenant?.name || principal?.activeTenant?.name || 'Current company';
  const hierarchyReviewed = readiness?.hierarchyReviewComplete === true;
  const categoriesReviewed = readiness?.headCategoriesReviewed === true;
  const commerciallyReady = readiness?.commerciallyReady === true;
  const displayedError = refreshError || (freshness.state === 'error' ? freshness.error : '');

  return <AdminPageShell title="Company Readiness" lead={`Commercial setup for ${tenantName}. Readiness is derived from the current company’s authoritative records.`}>
    <div className="admin-form__actions"><AdminButton variant="secondary" loading={refreshing} onClick={refresh}>Refresh readiness</AdminButton></div>
    {refreshing || !sameTenant || freshness.state === 'refreshing' || freshness.state === 'loading' || freshness.state === 'stale' ? <p className="admin-form__hint" role="status">Loading current company readiness…</p> : null}
    {displayedError ? <p className="admin-inline-warning" role="alert">{displayedError} {authoritative ? 'Existing readiness remains visible; retry when ready.' : 'Retry to load authoritative readiness.'}</p> : null}
    {authoritative && readiness && counts ? <><AdminKpiGrid items={[
      { label: 'Company', value: tenantName },
      { label: 'Active Cost Codes', value: String(counts.activeCostCodes ?? 0) },
      { label: 'Commercial Heads', value: String(counts.activeHeads ?? 0) },
      { label: 'Commercial readiness', value: commerciallyReady ? 'Ready' : 'Action required', tone: commerciallyReady ? 'success' : 'warning' },
    ]} />
    <p className="admin-inline-warning">A Development may be created before commercial setup is complete. Budget, procurement and CVR should begin only when the Cost Code hierarchy is ready.</p>
    <div className="admin-readiness-grid">
      <ReadinessItem title="Company" status={readiness.companySettingsReady ? 'Ready' : 'Set up'} tone={readiness.companySettingsReady ? 'success' : 'warning'} detail={readiness.companySettingsReady ? `${tenantName} has authoritative Company Settings.` : `${tenantName} is already the provisioned company identity. Review its financial and numbering defaults.`} action="Open Company Settings" onAction={() => onOpen('company')} />
      <ReadinessItem title="Commercial Structure" status={counts.activeHeads > 0 ? (categoriesReviewed ? 'Ready' : 'Review categories') : 'Not set up'} tone={counts.activeHeads > 0 && categoriesReviewed ? 'success' : 'warning'} detail={counts.activeHeads > 0 ? `${counts.activeHeads} active Heads; ${counts.categorizedHeads || 0} have BuildLite categories. Preliminaries and Selling Costs discovery categories are ${categoriesReviewed ? 'ready' : 'still required'}.` : 'No company Commercial Heads exist yet. The BuildLite recommended structure remains a preview only.'} action="Set up / Review Commercial Structure" onAction={() => onOpen('commercial-structure')} />
      <ReadinessItem title="Cost Codes" status={counts.activeCostCodes > 0 ? `${counts.activeCostCodes} active` : 'None imported'} tone={counts.activeCostCodes > 0 ? 'success' : 'warning'} detail={counts.activeCostCodes > 0 ? 'Customer codes and descriptions remain the company’s authority.' : 'Import the company’s own Excel or CSV Cost Code source. No demonstration chart is installed.'} action="Import Cost Codes" onAction={() => onOpen('cost-code-import')} />
      <ReadinessItem title="Hierarchy review" status={hierarchyReviewed ? 'Reviewed' : 'Action required'} tone={hierarchyReviewed ? 'success' : 'warning'} detail={`${counts.allocatedCostCodes ?? 0} Allocated · ${counts.notApplicableCostCodes ?? 0} Not Applicable · ${counts.notReviewedCostCodes ?? 0} Not Reviewed · ${counts.needsAttentionCostCodes ?? 0} Needs Attention`} action="Review Cost Code hierarchy" onAction={() => onOpen('cost-codes')} />
      <ReadinessItem title="Development" status={readiness.developmentExists ? `${counts.developments} created` : 'None created'} tone={readiness.developmentExists ? 'success' : 'muted'} detail={readiness.developmentExists ? 'Development existence is separate from company commercial readiness.' : 'Create the first Development when its identity is known; this does not mark the company commercially ready.'} action="Create Development" onAction={onOpenDevelopments} />
    </div></> : null}
  </AdminPageShell>;
}
