const CVR_PERIOD_SUBVIEWS = [
  ['summary', 'Summary'],
  ['worksheet', 'Worksheet'],
  ['movements', 'Movements'],
  ['exceptions', 'Exceptions'],
  ['commentary', 'Commentary'],
];

export default function CvrPeriodSubviewNav({ activeSubview, onSelect }) {
  return (
    <nav className="cvr-period-subnav" aria-label="CVR period views">
      {CVR_PERIOD_SUBVIEWS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={`cvr-period-subnav__item${activeSubview === key ? ' cvr-period-subnav__item--active' : ''}`}
          aria-current={activeSubview === key ? 'page' : undefined}
          onClick={() => onSelect?.(key)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
