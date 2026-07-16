import { NAV_BACK_LABEL } from '../../navigation/navigationTypes';
import { normalizeBreadcrumbs, resolveBackNavigation } from '../../navigation/navigationService';

function BreadcrumbTrail({ items = [] }) {
  if (!items.length) return null;

  return (
    <nav className="application-page-header__breadcrumbs" aria-label="Breadcrumb">
      <ol className="application-page-header__breadcrumb-list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const key = `${item.label}-${index}`;

          return (
            <li key={key} className="application-page-header__breadcrumb-item">
              {isLast || !item.onClick ? (
                <span
                  className={
                    isLast
                      ? 'application-page-header__breadcrumb-current'
                      : 'application-page-header__breadcrumb-static'
                  }
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <button
                  type="button"
                  className="application-page-header__breadcrumb-link"
                  onClick={item.onClick}
                >
                  {item.label}
                </button>
              )}
              {!isLast ? (
                <span className="application-page-header__breadcrumb-sep" aria-hidden="true">
                  &gt;
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default function ApplicationPageHeader({
  breadcrumbs = [],
  title,
  lead = '',
  eyebrow = '',
  onBack = null,
  backLabel = NAV_BACK_LABEL,
  actions = null,
  children = null,
  className = '',
  variant = 'page',
  showBack = true,
}) {
  const normalizedBreadcrumbs = normalizeBreadcrumbs(breadcrumbs);
  const resolvedBack = resolveBackNavigation(normalizedBreadcrumbs);
  const backHandler = onBack || resolvedBack.onBack;
  const shouldShowBack = showBack && Boolean(backHandler);

  return (
    <header
      className={[
        'application-page-header',
        `application-page-header--${variant}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="application-page-header__toolbar">
        {shouldShowBack ? (
          <button
            type="button"
            className="application-page-header__back"
            onClick={backHandler}
            aria-label={`${backLabel}${resolvedBack.parentLabel ? ` to ${resolvedBack.parentLabel}` : ''}`}
          >
            <span className="application-page-header__back-icon" aria-hidden="true">
              ←
            </span>
            {backLabel}
          </button>
        ) : (
          <span className="application-page-header__back-placeholder" aria-hidden="true" />
        )}

        {actions ? (
          <div className="application-page-header__actions">{actions}</div>
        ) : (
          <span className="application-page-header__actions-placeholder" aria-hidden="true" />
        )}
      </div>

      <div className="application-page-header__body">
        {eyebrow ? (
          <p className="application-page-header__eyebrow">{eyebrow}</p>
        ) : null}
        <BreadcrumbTrail items={normalizedBreadcrumbs} />
        {title ? <h1 className="application-page-header__title">{title}</h1> : null}
        {lead ? <p className="application-page-header__lead">{lead}</p> : null}
      </div>

      {children ? <div className="application-page-header__slot">{children}</div> : null}
    </header>
  );
}
