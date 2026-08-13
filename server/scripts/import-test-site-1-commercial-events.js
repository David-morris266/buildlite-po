/**
 * BL-028B.3 — Import Test Site 1 Commercial Events from UAT export JSON.
 *
 * Usage:
 *   node server/scripts/import-test-site-1-commercial-events.js [path-to-export.json]
 *
 * Default export path: docs/uat/test-site-1-commercial-events-export.json
 *
 * Performs pre-import package resolution + relationship checks before import.
 * Does NOT flip client authority — run that separately after parity verification.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { pool, init } = require('../db');
const { importCommercialEvents, resolvePackageForEvent } = require('../services/commercialEventRepository');

const TEST_SITE_ID = 'dev-1785599776666-zck5pl';
const DEFAULT_EXPORT = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'uat',
  'test-site-1-commercial-events-export.json'
);

function loadExport(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Export file not found: ${resolved}`);
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const events = Array.isArray(parsed.events) ? parsed.events : parsed;
  if (!Array.isArray(events)) {
    throw new Error('Export must contain an events array.');
  }
  return { resolved, payload: parsed, events };
}

function validateRelationships(events) {
  const anomalies = [];
  const ids = new Set(events.map((event) => event.id));
  const eventNumbers = new Map();

  for (const event of events) {
    if (!event?.id) {
      anomalies.push({ type: 'missing-id', eventNumber: event?.eventNumber || null });
    }
    if (event?.eventNumber && eventNumbers.has(event.eventNumber)) {
      anomalies.push({
        type: 'duplicate-eventNumber',
        eventNumber: event.eventNumber,
        ids: [eventNumbers.get(event.eventNumber), event.id],
      });
    } else if (event?.eventNumber) {
      eventNumbers.set(event.eventNumber, event.id);
    }
    if (event?.linkedEventId && !ids.has(event.linkedEventId)) {
      anomalies.push({
        type: 'dangling-linkedEventId',
        id: event.id,
        linkedEventId: event.linkedEventId,
      });
    }
  }

  return { ok: anomalies.length === 0, anomalies };
}

async function resolvePackages(clientId, developmentId, events) {
  const rows = [];
  for (const event of events) {
    const orderKey = String(event.packageId || event.orderKey || '').trim();
    const resolution = await resolvePackageForEvent(clientId, developmentId, {
      packageId: orderKey,
      orderKey,
      packageUuid: event.packageUuid,
    });
    rows.push({
      id: event.id,
      eventNumber: event.eventNumber,
      orderKey,
      packageUuid: resolution.ok ? resolution.packageRow.id : null,
      status: resolution.ok ? 'resolved' : 'FAILED',
      reason: resolution.ok ? null : resolution.message,
    });
  }
  return rows;
}

async function main() {
  const exportPath = process.argv[2] || DEFAULT_EXPORT;
  const { resolved, payload, events } = loadExport(exportPath);

  await init();

  const { rows: clients } = await pool.query(
    'SELECT id, code, name FROM clients WHERE is_active = true LIMIT 1'
  );
  const client = clients[0];
  if (!client) {
    throw new Error('No active client found.');
  }

  const relationship = validateRelationships(events);
  const packageRows = await resolvePackages(client.id, TEST_SITE_ID, events);
  const unresolved = packageRows.filter((row) => row.status !== 'resolved');

  const report = {
    exportFile: resolved,
    developmentId: payload.developmentId || TEST_SITE_ID,
    exportedAt: payload.exportedAt || null,
    eventCount: events.length,
    eventNumbers: events.map((event) => event.eventNumber),
    eventIds: events.map((event) => event.id),
    orderKeys: [...new Set(events.map((event) => event.packageId || event.orderKey).filter(Boolean))],
    auditEntryCount: events.reduce(
      (total, event) =>
        total + (Array.isArray(event.auditHistory) ? event.auditHistory.length : 0),
      0
    ),
    relationshipIntegrity: relationship,
    packageResolution: packageRows,
    unresolvedPackageCount: unresolved.length,
  };

  if (!relationship.ok) {
    console.log(JSON.stringify({ ...report, importBlocked: true, reason: 'relationship-integrity' }, null, 2));
    await pool.end();
    process.exit(1);
  }

  if (unresolved.length) {
    console.log(JSON.stringify({ ...report, importBlocked: true, reason: 'package-resolution' }, null, 2));
    await pool.end();
    process.exit(1);
  }

  const result = await importCommercialEvents(client.id, {
    developmentId: TEST_SITE_ID,
    events,
  });

  console.log(
    JSON.stringify(
      {
        ...report,
        importResult: result,
      },
      null,
      2
    )
  );

  await pool.end();

  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
