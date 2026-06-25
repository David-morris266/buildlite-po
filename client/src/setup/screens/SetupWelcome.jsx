const REASSURANCE = [
  { text: "About 10 minutes" },
  { text: "Save anytime" },
  { text: "Change later in Settings" },
];

const SETUP_TOPICS = [
  "Your company details",
  "How purchase orders look to suppliers",
  "Your usual VAT and retention rates",
  "Who approves orders on your team",
  "Cost codes and suppliers (optional)",
];

export default function SetupWelcome({ onStartSetup, onDoLater }) {
  return (
    <div className="setup-welcome setup-animate-in">
      <div className="setup-welcome__hero">
        <p className="setup-welcome__eyebrow">BuildLite Setup Assistant</p>
        <h1 className="setup-welcome__title">Let&apos;s get BuildLite ready</h1>
        <p className="setup-welcome__lead">
          We&apos;ll guide you through a short setup so your commercial team can
          raise purchase orders with confidence.
        </p>
        <p className="setup-welcome__promise">
          You can be creating your first Purchase Order in around{" "}
          <strong>10 minutes</strong>.
        </p>
      </div>

      <ul className="setup-welcome__pills" aria-label="Setup reassurance">
        {REASSURANCE.map((item, i) => (
          <li
            key={item.text}
            className="setup-welcome__pill setup-animate-in"
            style={{ animationDelay: `${120 + i * 80}ms` }}
          >
            <span className="setup-welcome__pill-dot" aria-hidden="true" />
            {item.text}
          </li>
        ))}
      </ul>

      <div className="setup-welcome__card setup-animate-in setup-animate-in--delay">
        <h2 className="setup-welcome__card-title">What we&apos;ll cover</h2>
        <ul className="setup-welcome__topics">
          {SETUP_TOPICS.map((topic) => (
            <li key={topic}>{topic}</li>
          ))}
        </ul>
        <p className="setup-welcome__help">
          Setting up commercial software for the first time? You can skip
          spreadsheets and add suppliers when you raise your first order.
        </p>
      </div>

      <div className="setup-welcome__actions">
        <button
          type="button"
          className="setup-btn setup-btn--primary"
          onClick={onStartSetup}
        >
          Start Setup
        </button>
        <button
          type="button"
          className="setup-btn setup-btn--link"
          onClick={onDoLater}
        >
          I&apos;ll do this later
        </button>
      </div>
    </div>
  );
}
