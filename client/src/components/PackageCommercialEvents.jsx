import { useEffect, useMemo, useState } from 'react';
import CommercialEventDrawer from './CommercialEventDrawer';
import { formatDisplayMoney, formatPoDate } from './poDrawerHelpers';
import { subscribeCommercialChanged } from '../commercial/commercialEvents';
import { listCommercialEventsByPackage, getCommercialEventById } from '../commercialEvents/commercialEventStore';
import { buildPackageCommercialEventSummaryForPackage, formatSignedCommercialEventValue } from '../commercialEvents/commercialEventPackageValue';
import { buildPackageRecoverySummary } from '../commercialEvents/commercialEventPackageRecoveryKpis';
import { getCommercialEventLinkBadges } from '../commercialEvents/commercialEventRegisterBadges';
import { getCommercialEventCertificationBadges } from '../commercialEvents/commercialEventCertificateLifecycle';
import {
  getCommercialEventStatusMeta,
  getCommercialEventTypeMeta,
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

function PackageCommercialEventRecoveryNote({ summary }) {
  if (!summary?.hasRecoveries) return null;

  return (
    <p className="po-ce-recovery-note" aria-label="Recovery summary">
      Recovery position:{' '}
      <strong>{formatDisplayMoney(summary.outstandingRecoveries)}</strong> outstanding
      {' · '}
      <strong>{formatDisplayMoney(summary.recoveredValue)}</strong> recovered
      {' · '}
      <strong>{summary.openRecoveryItems}</strong> open
    </p>
  );
}

function PackageCommercialEventKpiStrip({ summary, loading = false }) {
  const formatValue = (value, signed = false) => {
    if (loading) return 'Loading commercial data…';
    return signed
      ? formatSignedCommercialEventValue(value)
      : String(value ?? 0);
  };

  return (
    <section className="po-ce-kpi po-ce-kpi--events" aria-label="Commercial events on this package">
      <div className="po-ce-kpi__card po-ce-kpi__card--default">
        <span className="po-ce-kpi__label">Commercial events</span>
        <strong className="po-ce-kpi__value">{formatValue(summary.totalEventCount)}</strong>
      </div>
      <div className="po-ce-kpi__card po-ce-kpi__card--muted">
        <span className="po-ce-kpi__label">Pending value</span>
        <strong className="po-ce-kpi__value">
          {formatValue(summary.pendingEventValue, true)}
        </strong>
      </div>
      <div
        className={`po-ce-kpi__card po-ce-kpi__card--${
          summary.netCommercialEventMovement >= 0 ? 'default' : 'accent'
        }`}
      >
        <span className="po-ce-kpi__label">Approved movement</span>
        <strong className="po-ce-kpi__value">
          {formatValue(summary.netCommercialEventMovement, true)}
        </strong>
      </div>
      <div className="po-ce-kpi__card po-ce-kpi__card--muted">
        <span className="po-ce-kpi__label">Approved events</span>
        <strong className="po-ce-kpi__value">{formatValue(summary.approvedEventCount)}</strong>
      </div>
    </section>
  );
}

export default function PackageCommercialEvents({
  order,
  refreshToken = 0,
  commercialEventTarget = null,
  onCommercialEventsChanged = null,
  onNavigateToLinkedCommercialEvent = null,
  commercialEventsLoading = false,
  commercialEventsReady = true,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState('create');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    return subscribeCommercialChanged(() => {
      setLocalRefresh((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    if (!commercialEventTarget?.eventId || !order?.developmentId) return;

    const event = getCommercialEventById(
      order.developmentId,
      commercialEventTarget.eventId
    );
    if (!event) return;

    setSelectedEvent(event);
    setDrawerMode(commercialEventTarget.mode || 'view');
    setDrawerOpen(true);
  }, [
    commercialEventTarget?.eventId,
    commercialEventTarget?.navigationKey,
    commercialEventTarget?.mode,
    order?.developmentId,
  ]);

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

  const recoverySummary = useMemo(
    () => buildPackageRecoverySummary(events),
    [events]
  );

  function refreshRegisters() {
    setLocalRefresh((value) => value + 1);
    onCommercialEventsChanged?.();
  }

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
    refreshRegisters();
  }

  function handleLinkedRecoveryCreated(recovery) {
    refreshRegisters();
    setSelectedEvent(recovery);
    setDrawerMode('edit');
    setDrawerOpen(true);
  }

  function handleNavigateToLinkedEvent(sourceEvent) {
    if (!sourceEvent || !onNavigateToLinkedCommercialEvent) return;
    onNavigateToLinkedCommercialEvent(sourceEvent);
  }

  const commercialValuesPending = commercialEventsLoading || commercialEventsReady === false;

  return (
    <div className="po-ce-workspace">
      <PackageCommercialEventKpiStrip summary={summary} loading={commercialValuesPending} />
      <PackageCommercialEventRecoveryNote summary={recoverySummary} />

      <section className="po-module-card po-ce-register">
        <div className="po-ce-register__header">
          <div>
            <h2 className="po-matrix-section__title">Commercial Events register</h2>
            <p className="po-ce-register__lead">
              Record and track commercial events against this package. Only approved
              events affect current package value.
            </p>
          </div>
          <button type="button" className="po-btn-primary" onClick={openCreateDrawer}>
            New Commercial Event
          </button>
        </div>

        {commercialValuesPending ? (
          <p className="po-ce-register__empty">Loading commercial data…</p>
        ) : events.length === 0 ? (
          <p className="po-ce-register__empty">
            No commercial events recorded yet.
          </p>
        ) : (
          <div className="po-table-wrap">
            <table className="po-data-table po-ce-register__table po-ce-register__table--compact">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Value</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => {
                  const certificationBadges = getCommercialEventCertificationBadges(
                    event,
                    order?.orderKey
                  );
                  const badges = [
                    ...getCommercialEventLinkBadges(event),
                    ...certificationBadges,
                  ];
                  const certification = certificationBadges[0];
                  return (
                    <tr
                      key={event.id}
                      className="po-ce-register__row"
                      onClick={() => openEventDrawer(event, 'view')}
                    >
                      <td>
                        <div className="po-ce-register__event-cell">
                          <span className="po-ce-register__event-number">{event.eventNumber}</span>
                          {badges.length ? (
                            <span className="po-ce-register__badges">
                              {badges.map((badge) => (
                                <LinkBadge key={badge.key} badge={badge} />
                              ))}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>{getCommercialEventTypeMeta(event.eventType).label}</td>
                      <td className="po-ce-register__description">{event.description}</td>
                      <td>
                        <div className="po-ce-register__status-cell">
                          <StatusBadge statusKey={event.status} />
                          {certification ? (
                            <span
                              className={`po-ce-link-badge po-ce-link-badge--${certification.modifier}`}
                              title={certification.title || undefined}
                            >
                              {certification.label}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td
                        style={{ textAlign: 'right' }}
                        className={
                          Number(event.value) < 0
                            ? 'po-ce-value--negative'
                            : 'po-ce-value--positive'
                        }
                      >
                        {formatSignedCommercialEventValue(event.value)}
                      </td>
                      <td>{formatPoDate(event.dateRaised)}</td>
                    </tr>
                  );
                })}
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
        onLinkedRecoveryCreated={handleLinkedRecoveryCreated}
        onNavigateToLinkedEvent={handleNavigateToLinkedEvent}
      />
    </div>
  );
}
