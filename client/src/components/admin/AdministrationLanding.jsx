const CARD_META = {
  company: {
    icon: '🏢',
    title: 'Company',
    description: 'Identity, financial defaults and numbering rules.',
    accent: 'company',
    status: 'Configured',
  },
  'setup-data-import': {
    icon: '📥',
    title: 'Setup & Data Import',
    description: 'Re-run setup, import cost codes and future master data imports.',
    accent: 'company',
    status: 'Import',
  },
  users: {
    icon: '🛡️',
    title: 'Users',
    description: 'User directory for roles and approval rights.',
    accent: 'company',
    status: 'Placeholder',
  },
  clients: {
    icon: '👥',
    title: 'Clients',
    description: 'Client master records for developments.',
    accent: 'company',
    status: 'Active',
  },
  'approval-settings': {
    icon: '✅',
    title: 'Approval Settings',
    description: 'Approval rules for POs, certificates and CVRs.',
    accent: 'company',
    status: 'Placeholder',
  },
  'prelims-templates': {
    icon: '📐',
    title: 'Prelims Templates',
    description: 'BuildLite Standard and company-owned Prelims structures.',
    accent: 'commercial',
    status: 'Foundation',
  },
  'commercial-structure': {
    icon: '🧭',
    title: 'Commercial Cost Structure',
    description: 'Commercial Heads, Reporting Groups and Cost Codes.',
    accent: 'commercial',
    status: 'Live',
  },
  'cost-codes': {
    icon: '📋',
    title: 'Cost Codes',
    description: 'Master cost codes linked to commercial hierarchy.',
    accent: 'commercial',
    status: 'Master',
  },
  'commercial-behaviour': {
    icon: '⚙️',
    title: 'Commercial Behaviour',
    description: 'Default forecast and executive summary behaviour.',
    accent: 'commercial',
    status: 'Config',
  },
  'reporting-preview': {
    icon: '📊',
    title: 'Reporting Preview',
    description: 'Verify executive reporting structure.',
    accent: 'commercial',
    status: 'Read-only',
  },
  'validation-dashboard': {
    icon: '🩺',
    title: 'Validation Dashboard',
    description: 'Master data health check and diagnostics.',
    accent: 'commercial',
    status: 'Health',
  },
  suppliers: {
    icon: '🤝',
    title: 'Suppliers',
    description: 'Supplier records for POs and certificates.',
    accent: 'procurement',
    status: 'Live',
  },
  'developer-tools': {
    icon: '🛠️',
    title: 'Developer Tools',
    description: 'Development-only utilities and diagnostics.',
    accent: 'developer',
    status: 'Dev only',
  },
};

const GROUPS = [
  {
    id: 'company',
    title: 'Company',
    cardIds: ['company', 'setup-data-import', 'users', 'clients', 'approval-settings'],
  },
  {
    id: 'commercial',
    title: 'Commercial',
    cardIds: [
      'commercial-structure',
      'cost-codes',
      'commercial-behaviour',
      'prelims-templates',
      'reporting-preview',
      'validation-dashboard',
    ],
  },
  {
    id: 'procurement',
    title: 'Procurement',
    cardIds: ['suppliers'],
  },
];

const FUTURE_CARDS = [
  {
    id: 'future-revenue',
    icon: '💷',
    title: 'Revenue Recognition',
    description: 'Sales plot revenue and completion accounting.',
    status: 'Coming soon',
  },
  {
    id: 'future-bank',
    icon: '🏦',
    title: 'Bank Reconciliation',
    description: 'Ledger matching and cash management.',
    status: 'Coming soon',
  },
  {
    id: 'future-audit',
    icon: '📝',
    title: 'Audit Trail',
    description: 'Immutable change history across master data.',
    status: 'Coming soon',
  },
];

function DashboardCard({ card, onOpen, disabled = false }) {
  const meta = CARD_META[card.id] || card;

  if (disabled) {
    return (
      <article className="admin-module-card admin-module-card--disabled" aria-disabled="true">
        <div className="admin-module-card__top">
          <span className="admin-module-card__icon" aria-hidden="true">{meta.icon}</span>
          <span className="admin-chip admin-chip--muted">{meta.status}</span>
        </div>
        <h3 className="admin-module-card__title">{meta.title}</h3>
        <p className="admin-module-card__description">{meta.description}</p>
      </article>
    );
  }

  return (
    <article
      className={`admin-module-card admin-module-card--${meta.accent || 'commercial'}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(card.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(card.id);
        }
      }}
    >
      <div className="admin-module-card__top">
        <span className="admin-module-card__icon" aria-hidden="true">{meta.icon}</span>
        {meta.status ? <span className="admin-chip admin-chip--accent">{meta.status}</span> : null}
      </div>
      <h3 className="admin-module-card__title">{meta.title}</h3>
      <p className="admin-module-card__description">{meta.description}</p>
      <span className="admin-module-card__cta">Open module →</span>
    </article>
  );
}

export default function AdministrationLanding({ onOpen, showDeveloperTools }) {
  const groups = showDeveloperTools
    ? [
        ...GROUPS,
        {
          id: 'developer',
          title: 'Developer Tools',
          cardIds: ['developer-tools'],
        },
      ]
    : GROUPS;

  return (
    <div className="admin-landing admin-landing--control-centre">
      <header className="admin-landing-hero">
        <p className="admin-landing-hero__eyebrow">BuildLite Control Centre</p>
        <h1 className="admin-landing-hero__title">Administration</h1>
        <p className="admin-landing-hero__lead">
          Central configuration for company master data, commercial structure and procurement settings.
        </p>
      </header>

      {groups.map((group) => (
        <section key={group.id} className="admin-dashboard-group">
          <h2 className="admin-dashboard-group__title">{group.title}</h2>
          <div className="admin-module-grid">
            {group.cardIds.map((cardId) => (
              <DashboardCard
                key={cardId}
                card={{ id: cardId }}
                onOpen={onOpen}
                disabled={CARD_META[cardId]?.disabled}
              />
            ))}
          </div>
        </section>
      ))}

      <section className="admin-dashboard-group">
        <h2 className="admin-dashboard-group__title">Future Modules</h2>
        <div className="admin-module-grid">
          {FUTURE_CARDS.map((card) => (
            <DashboardCard key={card.id} card={card} onOpen={() => {}} disabled />
          ))}
        </div>
      </section>
    </div>
  );
}
