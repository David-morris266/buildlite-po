import CommercialAssistantIndicator from '../commercialAssistant/CommercialAssistantIndicator';
import { useBuildLitePermission, useBuildLitePrincipal } from '../auth/BuildLiteAuthProvider';

export default function BrandHeader({ activeTab, onTab }) {
  const canReleasePayments = useBuildLitePermission('payment_release.execute');
  const canViewPaymentApproval = useBuildLitePermission('payment_approval_run.view');
  const canCreatePo = useBuildLitePermission('po.create');
  const principal = useBuildLitePrincipal();
  const canAdmin = ['tenant.configure', 'users.manage', 'roles.manage', 'terms.publish']
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

      <nav className="nav">
        <CommercialAssistantIndicator />
        <button className={`tab ${activeTab === "home" ? "active" : ""}`} onClick={() => onTab("home")}>Home</button>
        {canViewPaymentApproval ? <button
          className={`tab ${activeTab === "payment-approval" ? "active" : ""}`}
          onClick={() => onTab("payment-approval")}
        >
          Payment Approval
        </button> : null}
        {canReleasePayments ? <button
          className={`tab ${activeTab === "payment-release" ? "active" : ""}`}
          onClick={() => onTab("payment-release")}
        >
          Payment Release
        </button> : null}
        {canAdmin ? <button
          className={`tab ${activeTab === "administration" ? "active" : ""}`}
          onClick={() => onTab("administration")}
        >
          Administration
        </button> : null}
        <button
          className={`tab ${activeTab === "cvrs" ? "active" : ""}`}
          onClick={() => onTab("cvrs")}
        >
          CVRs
        </button>
        <button
          className={`tab ${activeTab === "developments" ? "active" : ""}`}
          onClick={() => onTab("developments")}
        >
          Developments
        </button>
        {canCreatePo ? <button
          className={`tab ${activeTab === "form" ? "active" : ""}`}
          onClick={() => onTab("form")}
        >
          New Purchase Order
        </button> : null}
        <button
          className={`tab ${activeTab === "list" ? "active" : ""}`}
          onClick={() => onTab("list")}
        >
          Purchase Orders
        </button>
        <button
          className={`tab ${activeTab === "archive" ? "active" : ""}`}
          onClick={() => onTab("archive")}
        >
          Archive
        </button>
      </nav>
    </header>
  );
}
