/**
 * Shared page header for Purchase Order module screens (BL-010B.02).
 * Matches Setup Assistant eyebrow / title / lead pattern.
 */
export default function POPageHeader({ eyebrow, title, lead }) {
  return (
    <header className="po-page-header">
      <p className="po-page-header__eyebrow">{eyebrow}</p>
      <h1 className="po-page-header__title">{title}</h1>
      {lead ? <p className="po-page-header__lead">{lead}</p> : null}
    </header>
  );
}
