import { useMemo, useState } from 'react';
import CommercialEventDrawer from './CommercialEventDrawer';
import { formatMoney, formatPoDate } from './poDrawerHelpers';
import { listCommercialEventsByPackage } from '../commercialEvents/commercialEventStore';
import { buildPackageCommercialEventSummaryForPackage } from '../commercialEvents/commercialEventPackageValue';
import {
  getCommercialEventCategoryMeta,
  getCommercialEventResponsibilityMeta,
  getCommercialEventStatusMeta,
  getCommercialEventTypeMeta,
  isCommercialEventEditable,
} from '../commercialEvents/commercialEventTypes';

function StatusBadge({ statusKey }) {
  const status = getCommercialEventStatusMeta(statusKey);
  return (
    <span className={`po-status-badge po-status-badge--${status.modifier}`}>
      {status.label}
    </span>
  );
}

function CommercialEventKpiStrip({ summary }) {
  const cards = [
    {
      label: 'Original order value',
      value: `£${formatMoney(summary.originalOrderValue)}`,
      modifier: 'default',
    },
    {
      label: 'Pending events',
      value: `£${formatMoney(summary.pendingEventValue)}`,
      modifier: 'muted',
    },
    {
      label: 'Approved movement',
      value: `£${formatMoney(summary.netCommercialEventMovement)}`,
      modifier: summary.netCommercialEventMovement >= 0 ? 'default' : 'accent',
    },
    {
      label: 'Current package value',
      value: `£${formatMoney(summary.currentPackageValue)}`,
      modifier: 'accent',
    },
  ];

  return (
    <section className="po-ce-kpi" aria-label="Commercial event summary">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`po-ce-kpi__card po-ce-kpi__card--${card.modifier}`}
        >
          <span className="po-ce-kpi__label">{card.label}</span>
          <strong className="po-ce-kpi__value">{card.value}</strong>
        </div>
      ))}
    </section>
  );
}

export default function PackageCommercialEvents({ order, refreshToken = 0 }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('create');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  const events = useMemo(() => {
    void refreshToken;
    void localRefresh;
    if (!order?.developmentId || !order?.orderKey) return [];
    return listCommercialEventsByPackage(order.developmentId, order.orderKey);
  }, [order?.developmentId, order?.orderKey, refreshToken, localRefresh]);

  const summary = useMemo(
    () =>
      buildPackageCommercialEventSummaryForPackage(
        order?.committedValue || 0,
        events,
        order?.orderKey
      ),
    [order?.committedValue, order?.orderKey, events]
  );

  function openCreateDrawer() {
    setSelectedEvent(null);
    setDrawerMode('create');
    setDrawerOpen(true);
  }

  function openEventDrawer(event, mode = 'view') {
    setSelectedEvent(event);
    setDrawerMode(mode);
    setDrawerOpen(true);
  }

  function handleSaved() {
    setLocalRefresh((value) => value + 1);
  }

  return (
    <div className="po-ce-workspace">
      <CommercialEventKpiStrip summary={summary} />

      <section className="po-module-card po-ce-register">
        <div className="po-ce-register__header">
          <div>
            <h2 className="po-matrix-section__title">Commercial Events</h2>
            <p className="po-ce-register__lead">
              Record variations, contra charges and other commercial movements
              against this package. Only approved events affect current package value.
            </p>
          </div>
          <button type="button" className="po-btn-primary" onClick={openCreateDrawer}>
            New event
          </button>
        </div>

        {events.length === 0 ? (
          <p className="po-ce-register__empty">
            No commercial events recorded yet. Original order value remains
            £{formatMoney(summary.originalOrderValue)}.
          </p>
        ) : (
          <div className="po-table-wrap">
            <table className="po-data-table po-ce-register__table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Value</th>
                  <th>Date</th>
                  <th>Responsibility</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <button
                        type="button"
                        className="po-ce-register__link"
                        onClick={() => openEventDrawer(event, 'view')}
                      >
                        {event.eventNumber}
                      </button>
                    </td>
                    <td>{getCommercialEventTypeMeta(event.eventType).label}</td>
                    <td>{getCommercialEventCategoryMeta(event.category).label}</td>
                    <td>{event.description}</td>
                    <td>
                      <StatusBadge statusKey={event.status} />
                    </td>
                    <td
                      style={{ textAlign: 'right' }}
                      className={Number(event.value) < 0 ? 'po-ce-value--negative' : ''}
                    >
                      £{formatMoney(event.value)}
                    </td>
                    <td>{formatPoDate(event.dateRaised)}</td>
                    <td>
                      {getCommercialEventResponsibilityMeta(event.responsibility).label}
                    </td>
                    <td className="po-ce-register__actions">
                      <button
                        type="button"
                        className="po-list-btn-secondary"
                        onClick={() => openEventDrawer(event, 'view')}
                      >
                        View
                      </button>
                      {isCommercialEventEditable(event.status) ? (
                        <button
                          type="button"
                          className="po-list-btn-secondary"
                          onClick={() => openEventDrawer(event, 'edit')}
                        >
                          Edit
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CommercialEventDrawer
        open={drawerOpen}
        mode={drawerMode}
        event={selectedEvent}
        order={order}
        onClose={() => setDrawerOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  );
}
