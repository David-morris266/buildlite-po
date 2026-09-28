import CommercialAssistantIndicator from '../commercialAssistant/CommercialAssistantIndicator';
import { useBuildLitePermission, useBuildLitePrincipal } from '../auth/BuildLiteAuthProvider';

import { useOptionalUnsavedChanges } from '../navigation/UnsavedChangesContext.js';

export default function BrandHeader({ activeTab, onTab }) {
  const unsavedChanges = useOptionalUnsavedChanges();
  const selectTab = (tab) => {
    if (tab === activeTab) {
      onTab(tab);
      return;
    }
    const navigate = () => onTab(tab);
    if (unsavedChanges) unsavedChanges.requestNavigation(navigate);
    else navigate();
  };
  const canReleasePayments = useBuildLitePermission('payment_release.execute');
  const canViewPaymentApproval = useBuildLitePermission('payment_approval_run.view');
  const canCreatePo = useBuildLitePermission('po.create');
  const principal = useBuildLitePrincipal();
  const memberships = principal?.memberships || [];
  const activeCompanyName = principal?.activeTenant?.name || principal?.activeTenant?.code || 'Company unavailable';
  const switchCompany = (clientId) => {
    if (!clientId || clientId === principal?.activeTenant?.clientId) return;
    const navigate = () => principal?.switchTenant?.(clientId);
    if (unsavedChanges) unsavedChanges.requestNavigation(navigate);
    else navigate();
  };
  const canAdmin = principal?.platformPermissions?.includes('platform.tenant_provision')||['tenant.configure', 'users.manage', 'roles.manage', 'terms.publish', 'commercial_templates.manage', 'cost_code_classifications.manage', 'commercial_head_categories.manage']
    .some(permission => principal?.permissions?.includes(permission));
  return (
    <header className="brandbar">
      <div className="brand-left">
        <img src="/brand.svg" alt="Build Lite" height={28} />
        <div>
          <div className="brand-name">Build Lite</div>
          <div className="brand-tag">Lean Commercial Control</div>
        </div>
      </div>

      <div className="brand-company" aria-label="Active company context">
        <span className="brand-company__label">Company</span>
        {memberships.length > 1 ? (
          <select
            className="brand-company__select"
            aria-label="Switch active company"
            value={principal.activeTenant.clientId}
            onChange={(event) => switchCompany(event.target.value)}
          >
            {memberships.map((membership) => (
              <option key={membership.clientId} value={membership.clientId}>
                {membership.clientName || membership.clientCode} · {membership.roleName}
              </option>
            ))}
          </select>
        ) : <strong className="brand-company__name">{activeCompanyName}</strong>}
      </div>

      <nav className="nav">
        <CommercialAssistantIndicator />
        <button className={`tab ${activeTab === "home" ? "active" : ""}`} onClick={() => selectTab("home")}>Home</button>
        {canViewPaymentApproval ? <button
          className={`tab ${activeTab === "payment-approval" ? "active" : ""}`}
          onClick={() => selectTab("payment-approval")}
        >
          Payment Approval
        </button> : null}
        {canReleasePayments ? <button
          className={`tab ${activeTab === "payment-release" ? "active" : ""}`}
          onClick={() => selectTab("payment-release")}
        >
          Accounts
        </button> : null}
        {canAdmin ? <button
          className={`tab ${activeTab === "administration" ? "active" : ""}`}
          onClick={() => selectTab("administration")}
        >
          Administration
        </button> : null}
        <button
          className={`tab ${activeTab === "cvrs" ? "active" : ""}`}
          onClick={() => selectTab("cvrs")}
        >
          CVRs
        </button>
        <button
          className={`tab ${activeTab === "developments" ? "active" : ""}`}
          onClick={() => selectTab("developments")}
        >
          Developments
        </button>
        {canCreatePo ? <button
          className={`tab ${activeTab === "form" ? "active" : ""}`}
          onClick={() => selectTab("form")}
        >
          New Purchase Order
        </button> : null}
        <button
          className={`tab ${activeTab === "list" ? "active" : ""}`}
          onClick={() => selectTab("list")}
        >
          Purchase Orders
        </button>
        <button
          className={`tab ${activeTab === "archive" ? "active" : ""}`}
          onClick={() => selectTab("archive")}
        >
          Archive
        </button>
      </nav>
    </header>
  );
}
