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
          Form
        </button>
        <button
          className={`tab ${activeTab === "list" ? "active" : ""}`}
          onClick={() => onTab("list")}
        >
          List
        </button>
        <button
          className={`tab ${activeTab === "archive" ? "active" : ""}`}
          onClick={() => onTab("archive")}
        >
          Archive/Search
        </button>
      </nav>
    </header>
  );
}
