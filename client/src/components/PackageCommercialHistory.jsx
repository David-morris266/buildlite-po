import { useEffect, useMemo, useState } from 'react';
import { formatPoDateTime } from './poDrawerHelpers';
import { subscribeCommercialChanged } from '../commercial/commercialEvents';
import {
  buildPackageCommercialHistory,
  filterPackageHistoryEntries,
  PACKAGE_HISTORY_FILTER,
} from '../commercialEvents/packageCommercialHistory';

const HISTORY_FILTERS = [
  { id: PACKAGE_HISTORY_FILTER.all, label: 'All' },
  { id: PACKAGE_HISTORY_FILTER.po, label: 'PO' },
  { id: PACKAGE_HISTORY_FILTER.commercial, label: 'Commercial' },
  { id: PACKAGE_HISTORY_FILTER.recovery, label: 'Recovery' },
  { id: PACKAGE_HISTORY_FILTER.certificate, label: 'Certificates' },
  { id: PACKAGE_HISTORY_FILTER.matrix, label: 'Matrix' },
];

function PackageHistoryTimelineItem({ entry }) {
  return (
    <li
      className={`po-package-timeline__item po-package-timeline__item--${entry.modifier}`}
    >
      <div className="po-package-timeline__marker" aria-hidden="true">
        •
      </div>
      <div>
        <p className="po-package-timeline__label">{entry.label}</p>
        <p className="po-package-timeline__when">{formatPoDateTime(entry.when)}</p>
        {entry.actor ? (
          <p className="po-package-history__actor">{entry.actor}</p>
        ) : null}
        {entry.detail ? (
          <p className="po-package-history__detail">{entry.detail}</p>
        ) : null}
      </div>
    </li>
  );
}

export default function PackageCommercialHistory({
  order,
  refreshToken = 0,
  certRefreshToken = 0,
}) {
  const [activeFilter, setActiveFilter] = useState(PACKAGE_HISTORY_FILTER.all);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    return subscribeCommercialChanged(() => {
      setLocalRefresh((value) => value + 1);
    });
  }, []);

  const entries = useMemo(() => {
    void refreshToken;
    void certRefreshToken;
    void localRefresh;
    return buildPackageCommercialHistory(order);
  }, [order, refreshToken, certRefreshToken, localRefresh]);

  const filteredEntries = useMemo(
    () => filterPackageHistoryEntries(entries, activeFilter),
    [entries, activeFilter]
  );

  return (
    <section className="po-module-card po-package-history">
      <div className="po-package-history__header">
        <div>
          <h2 className="po-matrix-section__title">Package history</h2>
          <p className="po-package-history__lead">
            Audit-driven activity across purchase orders, commercial events,
            recoveries, certificates and the order matrix.
          </p>
        </div>
      </div>

      <div className="po-package-history__filters" role="tablist" aria-label="History filters">
        {HISTORY_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            role="tab"
            aria-selected={activeFilter === filter.id}
            className={`po-package-history__filter${
              activeFilter === filter.id ? ' po-package-history__filter--active' : ''
            }`}
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {filteredEntries.length === 0 ? (
        <p className="po-package-empty-note">
          {entries.length === 0
            ? 'No commercial history recorded for this package yet.'
            : 'No history entries match this filter.'}
        </p>
      ) : (
        <ol className="po-package-timeline po-package-history__timeline">
          {filteredEntries.map((entry) => (
            <PackageHistoryTimelineItem key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
    </section>
  );
}
