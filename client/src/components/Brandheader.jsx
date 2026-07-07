export default function BrandHeader({ activeTab, onTab, onOpenDeveloperTools }) {
  return (
    <header className="brandbar">
      <div className="brand-left">
        <img src="/brand.svg" alt="Build Lite" height={28} />
        <div>
          <div className="brand-name">Build Lite</div>
          <div className="brand-tag">Lean Commercial Control</div>
          <button
            type="button"
            className="brand-dev-tools"
            onClick={() => onOpenDeveloperTools?.()}
            title="Development-only utilities"
          >
            Developer Tools
          </button>
        </div>
      </div>

      <nav className="nav">
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
