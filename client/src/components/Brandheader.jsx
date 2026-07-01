export default function BrandHeader({ activeTab, onTab }) {
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
