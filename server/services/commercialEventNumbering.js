/**
 * BL-028A — Tenant-global Commercial Event number allocation.
 *
 * Company numbering settings remain client-local; server uses CE- / pad 4 default
 * until a shared tenant numbering source exists.
 */

const {
  DEFAULT_EVENT_NUMBER_PREFIX,
  DEFAULT_EVENT_NUMBER_PAD,
} = require("./commercialEventConstants");

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseNumberingValue(value, prefixRaw) {
  const prefix = String(prefixRaw || "").trim();
  if (!prefix) return null;

  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`, "i");
  const match = String(value || "").trim().match(pattern);
  if (!match) return null;

  return {
    sequence: Number.parseInt(match[1], 10),
    width: match[1].length,
  };
}

function generateNextCommercialEventNumber(
  existingValues = [],
  {
    prefix = DEFAULT_EVENT_NUMBER_PREFIX,
    defaultPad = DEFAULT_EVENT_NUMBER_PAD,
  } = {}
) {
  let maxSequence = 0;
  let width = defaultPad;

  for (const value of existingValues) {
    const parsed = parseNumberingValue(value, prefix);
    if (!parsed) continue;
    maxSequence = Math.max(maxSequence, parsed.sequence);
    width = Math.max(width, parsed.width);
  }

  const next = maxSequence + 1;
  return `${prefix}${String(next).padStart(width, "0")}`;
}

/**
 * Allocate next event number under advisory lock within an open transaction.
 * @param {import('pg').PoolClient} dbClient
 * @param {string} clientId
 */
async function allocateNextEventNumber(dbClient, clientId) {
  await dbClient.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `commercial-event-number:${clientId}`,
  ]);

  const { rows } = await dbClient.query(
    `
      SELECT event_number
      FROM commercial_events
      WHERE client_id = $1
    `,
    [clientId]
  );

  return generateNextCommercialEventNumber(rows.map((row) => row.event_number));
}

module.exports = {
  parseNumberingValue,
  generateNextCommercialEventNumber,
  allocateNextEventNumber,
};
