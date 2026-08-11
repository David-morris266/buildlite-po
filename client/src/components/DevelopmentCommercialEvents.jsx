import { useEffect, useMemo, useState } from 'react';
import CommercialEventDrawer from './CommercialEventDrawer';
import { formatPoDate } from './poDrawerHelpers';
import { subscribeCommercialChanged } from '../commercial/commercialEvents';
import { getCommercialEventById } from '../commercialEvents/commercialEventStore';
import {
  buildDevelopmentCommercialEventFilterOptions,
  buildDevelopmentCommercialEventPackageOptions,
  buildDevelopmentCommercialEventSummary,
  DEFAULT_DEVELOPMENT_COMMERCIAL_SORT,
  DEVELOPMENT_COMMERCIAL_SORT_KEYS,
  EMPTY_DEVELOPMENT_COMMERCIAL_FILTERS,
  filterDevelopmentCommercialEventRows,
  formatSignedCommercialEventValue,
  getDevelopmentCommercialRecoveryStatusLabel,
  getDevelopmentCommercialTypeLabel,
  hasActiveDevelopmentCommercialFilters,
  listEnrichedDevelopmentCommercialEvents,
  sortDevelopmentCommercialEventRows,
} from '../commercialEvents/commercialEventDevelopmentRegister';
import { formatRecoveryPackageOptionLabel } from '../commercialEvents/commercialEventRecoveryPackages';
import { formatMoney } from './poDrawerHelpers';
import { getLinkedEventNavigationLabel } from '../commercialEvents/commercialEventNavigation';
import { getCommercialEventLinkBadges } from '../commercialEvents/commercialEventRegisterBadges';
import {
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
  getCommercialEventStatusMeta,
} from '../commercialEvents/commercialEventTypes';

function StatusBadge({ statusKey }) {
  const status = getCommercialEventStatusMeta(statusKey);
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

function LinkBadge({ badge }) {
  return (
    <span className={`po-ce-link-badge po-ce-link-badge--${badge.modifier}`}>
      {badge.label}
    </span>
  );
}

function DevelopmentCommercialKpiStrip({ summary }) {
  const cards = [
    { key: 'totalEvents', label: 'Total Commercial Events' },
    { key: 'draftCount', label: 'Draft' },
    { key: 'submittedCount', label: 'Submitted' },
    { key: 'approvedCount', label: 'Approved' },
    { key: 'potentialContraNotRaisedCount', label: 'Recoveries not yet raised' },
    {
      key: 'outstandingRecoveryAmount',
      label: 'Outstanding Recoveries',
      signed: true,
    },
    {
      key: 'netApprovedMovement',
      label: 'Net Approved Commercial Movement',
      signed: true,
    },
  ];

  return (
    <section className="po-ce-kpi po-ce-kpi--development" aria-label="Development commercial event summary">
      {cards.map((card) => {
        const raw = summary[card.key];
        const value = card.signed
          ? formatSignedCommercialEventValue(raw)
          : String(raw ?? 0);
        const modifier =
          card.signed && Number(raw) < 0
            ? 'accent'
            : card.key === 'netApprovedMovement'
              ? 'default'
              : 'muted';

        return (
          <div
            key={card.key}
            className={`po-ce-kpi__card po-ce-kpi__card--${modifier}`}
          >
            <span className="po-ce-kpi__label">{card.label}</span>
            <strong className="po-ce-kpi__value">{value}</strong>
          </div>
        );
      })}
    </section>
  );
}

function SortableHeader({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey;
  const direction = active ? sort.direction : 'desc';

  return (
    <button
      type="button"
      className={`po-ce-dev-register__sort${active ? ' po-ce-dev-register__sort--active' : ''}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active ? (direction === 'asc' ? ' ↑' : ' ↓') : null}
    </button>
  );
}

export default function DevelopmentCommercialEvents({
  model,
  commercialEventTarget = null,
  onCommercialEventTargetHandled = null,
  onOpenPackage = null,
  onNavigateToLinkedCrossPackage = null,
  registerError = '',
  onRegisterError = null,
}) {
  const [localRefresh, setLocalRefresh] = useState(0);
  const [filters, setFilters] = useState(EMPTY_DEVELOPMENT_COMMERCIAL_FILTERS);
  const [sort, setSort] = useState(DEFAULT_DEVELOPMENT_COMMERCIAL_SORT);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('view');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [packagePickerOpen, setPackagePickerOpen] = useState(false);
  const [selectedPackageOrderKey, setSelectedPackageOrderKey] = useState('');
  const [createPackageOrder, setCreatePackageOrder] = useState(null);

  const developmentId = model?.id;

  useEffect(() => {
    return subscribeCommercialChanged(() => {
      setLocalRefresh((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    if (!commercialEventTarget?.eventId || !developmentId) return;

    const event = getCommercialEventById(developmentId, commercialEventTarget.eventId);
    if (!event) {
      onCommercialEventTargetHandled?.();
      return;
    }

    setSelectedEvent(event);
    setDrawerMode(commercialEventTarget.mode || 'view');
    setDrawerOpen(true);
    onCommercialEventTargetHandled?.();
  }, [
    commercialEventTarget?.eventId,
    commercialEventTarget?.navigationKey,
    commercialEventTarget?.mode,
    developmentId,
    onCommercialEventTargetHandled,
  ]);

  const rows = useMemo(() => {
    void localRefresh;
    if (!developmentId) return [];
    return listEnrichedDevelopmentCommercialEvents(developmentId, model?.packages || []);
  }, [developmentId, model?.packages, localRefresh]);

  const summary = useMemo(() => {
    void localRefresh;
    if (!developmentId) {
      return buildDevelopmentCommercialEventSummary('', []);
    }
    return buildDevelopmentCommercialEventSummary(developmentId, model?.packages || []);
  }, [developmentId, model?.packages, localRefresh]);

  const filterOptions = useMemo(
    () => buildDevelopmentCommercialEventFilterOptions(rows),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const filtered = filterDevelopmentCommercialEventRows(rows, filters);
    return sortDevelopmentCommercialEventRows(filtered, sort);
  }, [rows, filters, sort]);

  const packageOptions = useMemo(
    () => buildDevelopmentCommercialEventPackageOptions(model?.packages || []),
    [model?.packages]
  );

  const drawerOrder = useMemo(() => {
    if (drawerMode === 'create' && createPackageOrder) {
      return createPackageOrder;
    }

    if (!selectedEvent || !developmentId) return null;
    const row = rows.find((item) => item.event.id === selectedEvent.id);
    const packageRow =
      model?.packages?.find((pkg) => pkg.orderKey === selectedEvent.packageId) || null;

    if (packageRow) return packageRow;

    return {
      developmentId,
      orderKey: selectedEvent.packageId,
      supplierId: selectedEvent.supplierId,
      costCode: selectedEvent.costCode,
      supplierLabel: row?.supplierName || selectedEvent.supplierId || '—',
      projectLabel: model?.developmentName || 'Development',
      committedValue: 0,
      poNumbers: row?.poNumbers || [],
    };
  }, [
    drawerMode,
    createPackageOrder,
    selectedEvent,
    rows,
    model?.packages,
    model?.developmentName,
    developmentId,
  ]);

  function refreshRegister() {
    setLocalRefresh((value) => value + 1);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setCreatePackageOrder(null);
    setSelectedPackageOrderKey('');
  }

  function openCreatePackagePicker() {
    setSelectedEvent(null);
    setDrawerMode('create');
    setCreatePackageOrder(null);
    setSelectedPackageOrderKey('');
    setPackagePickerOpen(true);
    onRegisterError?.('');
  }

  function closePackagePicker() {
    setPackagePickerOpen(false);
    setSelectedPackageOrderKey('');
  }

  function confirmPackageSelection() {
    const selected = packageOptions.find(
      (option) => option.orderKey === selectedPackageOrderKey
    );
    if (!selected) return;

    setCreatePackageOrder(selected.packageRow);
    setPackagePickerOpen(false);
    setDrawerOpen(true);
  }

  function openEventDrawer(event, mode = 'view') {
    setCreatePackageOrder(null);
    setSelectedPackageOrderKey('');
    setSelectedEvent(event);
    setDrawerMode(mode);
    setDrawerOpen(true);
    onRegisterError?.('');
  }

  function handleSort(sortKey) {
    setSort((current) => {
      if (current.key === sortKey) {
        return {
          key: sortKey,
          direction: current.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return { key: sortKey, direction: sortKey === 'dateRaised' ? 'desc' : 'asc' };
    });
  }

  function clearFilters() {
    setFilters(EMPTY_DEVELOPMENT_COMMERCIAL_FILTERS);
  }

  function handleSaved() {
    refreshRegister();
  }

  function handleLinkedRecoveryCreated(recovery) {
    refreshRegister();
    setSelectedEvent(recovery);
    setDrawerMode('edit');
    setDrawerOpen(true);
  }

  function handleNavigateToLinkedEvent(sourceEvent) {
    if (!sourceEvent || !developmentId) return;

    const linked = getCommercialEventById(developmentId, sourceEvent.linkedEventId);

    if (!linked) {
      onRegisterError?.('Related commercial event is no longer available');
      return;
    }

    if (linked.packageId === sourceEvent.packageId) {
      openEventDrawer(linked, 'view');
      onRegisterError?.('');
      return;
    }

    onNavigateToLinkedCrossPackage?.(sourceEvent);
  }

  function handleOpenPackageFromDrawer() {
    if (!selectedEvent) return;
    onOpenPackage?.(selectedEvent);
  }

  if (!model) return null;

  const filtersActive = hasActiveDevelopmentCommercialFilters(filters);

  return (
    <div className="po-ce-dev-register">
      <DevelopmentCommercialKpiStrip summary={summary} />

      <section className="po-module-card po-ce-register">
        <div className="po-ce-register__header">
          <div>
            <h2 className="po-matrix-section__title">Commercial Events</h2>
            <p className="po-ce-register__lead">
              Development-wide register of commercial events across all packages.
              Open an event to review details or navigate to its package.
            </p>
          </div>
          <button
            type="button"
            className="po-btn-primary"
            onClick={openCreatePackagePicker}
          >
            New Commercial Event
          </button>
        </div>

        <div className="po-module-card po-filters po-ce-dev-register__filters">
          <input
            className="input"
            placeholder="Search events"
            value={filters.search}
            onChange={(event) =>
              setFilters((current) => ({ ...current, search: event.target.value }))
            }
            aria-label="Search commercial events"
          />
          <select
            className="select"
            value={filters.commercialStatus}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                commercialStatus: event.target.value,
              }))
            }
            aria-label="Filter by commercial status"
          >
            <option value="">Commercial status</option>
            {Object.values(COMMERCIAL_EVENT_STATUSES).map((status) => (
              <option key={status.key} value={status.key}>
                {status.label}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={filters.eventType}
            onChange={(event) =>
              setFilters((current) => ({ ...current, eventType: event.target.value }))
            }
            aria-label="Filter by event type"
          >
            <option value="">Event type</option>
            {Object.values(COMMERCIAL_EVENT_TYPES).map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={filters.recoveryStatus}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                recoveryStatus: event.target.value,
              }))
            }
            aria-label="Filter by recovery status"
          >
            <option value="">Recovery status</option>
            {[
              'notApplicable',
              'outstanding',
              'includedInCertificate',
              'partiallyRecovered',
              'fullyRecovered',
              'closed',
              'writtenOff',
            ].map((key) => (
              <option key={key} value={key}>
                {getDevelopmentCommercialRecoveryStatusLabel(key)}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={filters.supplier}
            onChange={(event) =>
              setFilters((current) => ({ ...current, supplier: event.target.value }))
            }
            aria-label="Filter by supplier"
          >
            <option value="">Supplier</option>
            {filterOptions.suppliers.map((supplier) => (
              <option key={supplier} value={supplier}>
                {supplier}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={filters.packageId}
            onChange={(event) =>
              setFilters((current) => ({ ...current, packageId: event.target.value }))
            }
            aria-label="Filter by package"
          >
            <option value="">Package</option>
            {filterOptions.packages.map((pkg) => (
              <option key={pkg.orderKey} value={pkg.orderKey}>
                {pkg.label}
              </option>
            ))}
          </select>
          {filtersActive ? (
            <button type="button" className="po-list-btn-secondary" onClick={clearFilters}>
              Clear Filters
            </button>
          ) : null}
        </div>

        {registerError ? (
          <div className="po-list-feedback po-list-feedback--error" role="alert">
            {registerError}
          </div>
        ) : null}

        <p className="po-ce-dev-register__count" aria-live="polite">
          {filteredRows.length} event{filteredRows.length === 1 ? '' : 's'}
          {filtersActive ? ' matching filters' : ''}
        </p>

        {rows.length === 0 ? (
          <p className="po-ce-register__empty">
            No commercial events recorded for this development yet.
          </p>
        ) : filteredRows.length === 0 ? (
          <p className="po-ce-register__empty">
            No commercial events match the current filters.
          </p>
        ) : (
          <div className="po-table-wrap">
            <table className="po-data-table po-ce-register__table po-ce-dev-register__table">
              <thead>
                <tr>
                  <th>
                    <SortableHeader
                      label="Event"
                      sortKey={DEVELOPMENT_COMMERCIAL_SORT_KEYS.eventNumber}
                      sort={sort}
                      onSort={handleSort}
                    />
                  </th>
                  <th>Package</th>
                  <th>Type</th>
                  <th>
                    <SortableHeader
                      label="Status"
                      sortKey={DEVELOPMENT_COMMERCIAL_SORT_KEYS.status}
                      sort={sort}
                      onSort={handleSort}
                    />
                  </th>
                  <th style={{ textAlign: 'right' }}>
                    <SortableHeader
                      label="Value"
                      sortKey={DEVELOPMENT_COMMERCIAL_SORT_KEYS.value}
                      sort={sort}
                      onSort={handleSort}
                    />
                  </th>
                  <th>
                    <SortableHeader
                      label="Date Raised"
                      sortKey={DEVELOPMENT_COMMERCIAL_SORT_KEYS.dateRaised}
                      sort={sort}
                      onSort={handleSort}
                    />
                  </th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const badges = getCommercialEventLinkBadges(row.event);
                  return (
                    <tr
                      key={row.event.id}
                      className="po-ce-dev-register__row"
                      onClick={() => openEventDrawer(row.event, 'view')}
                    >
                      <td>
                        <div className="po-ce-register__event-cell">
                          <span className="po-ce-dev-register__event-number">
                            {row.event.eventNumber}
                          </span>
                          {badges.length ? (
                            <span className="po-ce-register__badges">
                              {badges.map((badge) => (
                                <LinkBadge key={badge.key} badge={badge} />
                              ))}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className={row.packageMissing ? 'po-ce-dev-register__missing' : ''}>
                        {row.packageLabel}
                      </td>
                      <td>{getDevelopmentCommercialTypeLabel(row.event.eventType)}</td>
                      <td>
                        <StatusBadge statusKey={row.event.status} />
                      </td>
                      <td
                        style={{ textAlign: 'right' }}
                        className={
                          Number(row.event.value) < 0 ? 'po-ce-value--negative' : 'po-ce-value--positive'
                        }
                      >
                        {formatSignedCommercialEventValue(row.event.value)}
                      </td>
                      <td>{formatPoDate(row.event.dateRaised)}</td>
                      <td>
                        {row.linkedEventUnavailable ? (
                          <span className="po-ce-dev-register__missing">Unavailable</span>
                        ) : row.linkedEventNumber ? (
                          <span>{row.linkedEventNumber}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {packagePickerOpen ? (
        <div
          className="po-ce-dev-register__package-picker-backdrop"
          onClick={closePackagePicker}
          aria-hidden="true"
        />
      ) : null}

      {packagePickerOpen ? (
        <section
          className="po-module-card po-ce-dev-register__package-picker"
          role="dialog"
          aria-modal="true"
          aria-label="Select package for new commercial event"
        >
          <header className="po-ce-dev-register__package-picker-header">
            <div>
              <h3 className="po-matrix-section__title">New Commercial Event</h3>
              <p className="po-ce-register__lead">
                Select the package this commercial event belongs to.
              </p>
            </div>
            <button type="button" className="po-list-btn-secondary" onClick={closePackagePicker}>
              Cancel
            </button>
          </header>

          {packageOptions.length === 0 ? (
            <p className="po-ce-register__empty">
              No valid packages are available in this development.
            </p>
          ) : (
            <div className="po-ce-drawer__package-picker">
              {packageOptions.map((option) => (
                <label
                  key={option.orderKey}
                  className={`po-ce-drawer__package-option${
                    selectedPackageOrderKey === option.orderKey
                      ? ' po-ce-drawer__package-option--selected'
                      : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="developmentCommercialPackage"
                    value={option.orderKey}
                    checked={selectedPackageOrderKey === option.orderKey}
                    onChange={() => setSelectedPackageOrderKey(option.orderKey)}
                  />
                  <span className="po-ce-drawer__package-option-body">
                    <strong>{formatRecoveryPackageOptionLabel(option)}</strong>
                    <span>
                      Current package value £{formatMoney(option.currentPackageValue)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="po-ce-drawer__actions">
            <button type="button" className="po-list-btn-secondary" onClick={closePackagePicker}>
              Cancel
            </button>
            <button
              type="button"
              className="po-btn-primary"
              disabled={!selectedPackageOrderKey}
              onClick={confirmPackageSelection}
            >
              Continue
            </button>
          </div>
        </section>
      ) : null}

      <CommercialEventDrawer
        open={drawerOpen}
        mode={drawerMode}
        event={selectedEvent}
        order={drawerOrder}
        onClose={closeDrawer}
        onSaved={handleSaved}
        onLinkedRecoveryCreated={handleLinkedRecoveryCreated}
        onNavigateToLinkedEvent={handleNavigateToLinkedEvent}
        onOpenPackage={selectedEvent?.packageId ? handleOpenPackageFromDrawer : null}
        openPackageLabel="Open Package"
      />
    </div>
  );
}
