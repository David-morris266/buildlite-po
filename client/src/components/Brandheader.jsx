import CommercialAssistantIndicator from '../commercialAssistant/CommercialAssistantIndicator';
import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';

export default function BrandHeader({ activeTab, onTab }) {
  const canReleasePayments = useBuildLitePermission('payment_release.execute');
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
        <button
          className={`tab ${activeTab === "payment-approval" ? "active" : ""}`}
          onClick={() => onTab("payment-approval")}
        >
          Payment Approval
        </button>
        {canReleasePayments ? <button
          className={`tab ${activeTab === "payment-release" ? "active" : ""}`}
          onClick={() => onTab("payment-release")}
        >
          Payment Release
        </button> : null}
        <button
          className={`tab ${activeTab === "administration" ? "active" : ""}`}
          onClick={() => onTab("administration")}
        >
          Administration
        </button>
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
        <button
          className={`tab ${activeTab === "form" ? "active" : ""}`}
          onClick={() => onTab("form")}
        >
          New Purchase Order
        </button>
        <button
          className={`tab ${activeTab === "list" ? "active" : ""}`}
          onClick={() => onTab("list")}
        >
          Purchase Orders
        </button>
        <button
          className={`tab ${activeTab === "certificates" ? "active" : ""}`}
          onClick={() => onTab("certificates")}
        >
          Payment Certificates
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
