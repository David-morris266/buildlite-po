export function AdminKpiGrid({ items = [], className = '' }) {
  return (
    <section className={['admin-kpi-grid', className].filter(Boolean).join(' ')} aria-label="Key metrics">
      {items.map((item) => (
        <article
          key={item.label}
          className={[
            'admin-kpi-card',
            item.tone ? `admin-kpi-card--${item.tone}` : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="admin-kpi-card__label">{item.label}</span>
          <div className="admin-kpi-card__value-row">
            <strong className="admin-kpi-card__value">{item.value}</strong>
            {item.valueSuffix ? <span className="admin-kpi-card__suffix">{item.valueSuffix}</span> : null}
          </div>
          {item.secondaryHint ? <span className="admin-kpi-card__hint">{item.secondaryHint}</span> : null}
          {!item.secondaryHint && item.hint ? <span className="admin-kpi-card__hint">{item.hint}</span> : null}
        </article>
      ))}
    </section>
  );
}

export function AdminEmptyState({ icon = '✓', title, message, tone = 'neutral' }) {
  return (
    <div className={`admin-empty-state admin-empty-state--${tone}`}>
      <span className="admin-empty-state__icon" aria-hidden="true">{icon}</span>
      <strong className="admin-empty-state__title">{title}</strong>
      <p className="admin-empty-state__message">{message}</p>
    </div>
  );
}

export function AdminStatusBadge({ children, tone = 'success' }) {
  return (
    <span className={`admin-chip admin-chip--${tone}`}>{children}</span>
  );
}

export function AdminSkeleton({ rows = 4 }) {
  return (
    <div className="admin-skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="admin-skeleton__row" />
      ))}
    </div>
  );
}

export function AdminDataTable({ children, className = '' }) {
  return (
    <div className={['admin-table-wrap po-module-card', className].filter(Boolean).join(' ')}>
      <table className="admin-table po-data-table">{children}</table>
    </div>
  );
}

export function AdminButton({
  children,
  variant = 'primary',
  type = 'button',
  disabled = false,
  loading = false,
  onClick,
  className = '',
}) {
  return (
    <button
      type={type}
      className={[
        'admin-btn',
        `admin-btn--${variant}`,
        loading ? 'admin-btn--loading' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {loading ? <span className="admin-btn__spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function AdminSectionNav({ sections = [], active, onChange }) {
  return (
    <nav className="admin-section-nav" aria-label="Page sections">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          className={[
            'admin-section-nav__item',
            active === section.id ? 'admin-section-nav__item--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onChange(section.id)}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}
