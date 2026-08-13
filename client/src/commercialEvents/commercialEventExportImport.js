/**
 * BL-028B.3 — Test Site 1 Commercial Event export / pre-import validation (UAT tooling).
 *
 * Does NOT delete or mutate localStorage during export.
 */

import { COMMERCIAL_EVENTS_STORAGE_KEY } from './commercialEventStore';

export const TEST_SITE_1_DEVELOPMENT_ID = 'dev-1785599776666-zck5pl';

export const DEFAULT_TEST_SITE_1_EXPORT_PATH =
  'docs/uat/test-site-1-commercial-events-export.json';

function readCommercialEventsStoreRaw() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(COMMERCIAL_EVENTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Export raw Test Site 1 CE bucket from localStorage without destructive normalisation.
 */
export function exportTestSite1CommercialEventsFromLocalStorage(
  developmentId = TEST_SITE_1_DEVELOPMENT_ID
) {
  const all = readCommercialEventsStoreRaw();
  const bucket = all[developmentId];
  const events = Array.isArray(bucket?.events) ? bucket.events.map((event) => ({ ...event })) : [];

  return {
    exportedAt: new Date().toISOString(),
    developmentId,
    storageKey: COMMERCIAL_EVENTS_STORAGE_KEY,
    eventCount: events.length,
    events,
    summary: summarizeCommercialEventExport(events),
  };
}

export function summarizeCommercialEventExport(events = []) {
  const eventNumbers = events.map((event) => event.eventNumber).filter(Boolean);
  const ids = events.map((event) => event.id).filter(Boolean);
  const orderKeys = [...new Set(events.map((event) => event.packageId).filter(Boolean))];
  const linkedPairs = events
    .filter((event) => event.linkedEventId)
    .map((event) => ({ id: event.id, linkedEventId: event.linkedEventId }));
  const auditEntryCount = events.reduce(
    (total, event) => total + (Array.isArray(event.auditHistory) ? event.auditHistory.length : 0),
    0
  );
  const statusCounts = events.reduce((acc, event) => {
    const key = event.status || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    eventCount: events.length,
    eventNumbers,
    ids,
    orderKeys,
    linkedPairs,
    auditEntryCount,
    statusCounts,
  };
}

export function validateCommercialEventRelationshipIntegrity(events = []) {
  const anomalies = [];
  const ids = new Set(events.map((event) => event.id));
  const eventNumbers = new Map();

  for (const event of events) {
    if (!event?.id) {
      anomalies.push({ type: 'missing-id', eventNumber: event?.eventNumber || null });
      continue;
    }

    if (eventNumbers.has(event.eventNumber)) {
      anomalies.push({
        type: 'duplicate-eventNumber',
        eventNumber: event.eventNumber,
        ids: [eventNumbers.get(event.eventNumber), event.id],
      });
    } else if (event.eventNumber) {
      eventNumbers.set(event.eventNumber, event.id);
    }

    if (event.linkedEventId && !ids.has(event.linkedEventId)) {
      anomalies.push({
        type: 'dangling-linkedEventId',
        id: event.id,
        linkedEventId: event.linkedEventId,
      });
    }
  }

  return {
    ok: anomalies.length === 0,
    anomalies,
  };
}

export function downloadTestSite1CommercialEventsExport(
  developmentId = TEST_SITE_1_DEVELOPMENT_ID,
  filename = 'test-site-1-commercial-events-export.json'
) {
  const payload = exportTestSite1CommercialEventsFromLocalStorage(developmentId);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return payload;
}
