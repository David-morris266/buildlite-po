const REASSURANCE = [
  { text: "About 10 minutes" },
  { text: "Save anytime" },
  { text: "Change later in Company Settings" },
];

const SETUP_TOPICS_NOW = [
  "Your company details",
  "How purchase orders look to suppliers",
  "Your usual commercial defaults",
];

const SETUP_TOPICS_NEXT = [
  "A supplier and cost code to get ordering",
  "Who approves orders",
  "Your first purchase order",
];

export default function SetupWelcome({ onStartSetup, onDoLater }) {
  return (
    <div className="setup-welcome setup-animate-in">
      <div className="setup-welcome__hero">
        <p className="setup-welcome__eyebrow">Getting started</p>
        <h1 className="setup-welcome__title">Let&apos;s get BuildLite ready</h1>
        <p className="setup-welcome__lead">
          A short guided setup so your commercial team can raise purchase
          orders with confidence. Most people finish in around ten minutes.
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

        <p className="setup-welcome__topics-label">Up first</p>
        <ul className="setup-welcome__topics">
          {SETUP_TOPICS_NOW.map((topic) => (
            <li key={topic}>{topic}</li>
          ))}
        </ul>

        <p className="setup-welcome__topics-label">Then</p>
        <ul className="setup-welcome__topics setup-welcome__topics--next">
          {SETUP_TOPICS_NEXT.map((topic) => (
            <li key={topic}>{topic}</li>
          ))}
        </ul>

        <p className="setup-welcome__help">
          We&apos;ll add one supplier in setup — you can build out your full
          lists later in Company Settings.
        </p>
      </div>

      <div className="setup-welcome__actions">
        <button
          type="button"
          className="setup-btn setup-btn--primary"
          onClick={onStartSetup}
        >
          Start setup
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
