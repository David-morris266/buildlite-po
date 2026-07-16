/**
 * BL-017C — Consistent workspace section headings (sentence case, muted support line).
 */
export default function SectionHeading({
  title,
  support = '',
  description = '',
  actions = null,
  className = '',
}) {
  return (
    <header
      className={['bl-section-heading', className].filter(Boolean).join(' ')}
    >
      <div className="bl-section-heading__content">
        <h2 className="bl-section-heading__title">{title}</h2>
        {support ? <p className="bl-section-heading__support">{support}</p> : null}
        {description ? (
          <p className="bl-section-heading__description">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="bl-section-heading__actions">{actions}</div> : null}
    </header>
  );
}
