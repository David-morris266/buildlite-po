import SetupProgress from "./SetupProgress";

/**
 * Shared shell for every Setup Assistant screen (BL-007A.01 framework).
 */
export default function SetupLayout({
  currentStep = 1,
  children,
  footer,
  showProgress = true,
}) {
  return (
    <div className="setup-assistant">
      <div className="setup-assistant__backdrop" aria-hidden="true" />

      <header className="setup-assistant__header">
        <div className="setup-assistant__brand">
          <img src="/brand.svg" alt="BuildLite" className="setup-assistant__logo" />
          <div>
            <div className="setup-assistant__product">Build Lite</div>
            <div className="setup-assistant__tagline">Lean Commercial Control</div>
          </div>
        </div>
        <div className="setup-assistant__header-badge">Setup Assistant</div>
      </header>

      {showProgress && (
        <div className="setup-assistant__progress-wrap">
          <SetupProgress currentStep={currentStep} />
        </div>
      )}

      <main className="setup-assistant__main">{children}</main>

      {footer ? <footer className="setup-assistant__footer">{footer}</footer> : null}
    </div>
  );
}
