/**
 * BL-033C — Validate development programme PUT body.
 * firstCompletion is optional; if present it must sit within siteStart..finalCompletion.
 * Does not infer firstCompletion from Plot Master sales dates.
 */

const {
  inclusiveCalendarMonthCount,
  toIsoDate,
} = require("./programmeCalendar");

function parseExpectedVersion(value) {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function parseRequiredDate(value, field, errors) {
  const iso = toIsoDate(value);
  if (!iso) {
    errors.push(`${field} must be a YYYY-MM-DD date.`);
    return null;
  }
  return iso;
}

function parseOptionalDate(value, field, errors) {
  if (value == null || value === "") return null;
  return parseRequiredDate(value, field, errors);
}

function parseTotalPlots(value, errors) {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors.push("totalPlots must be a non-negative integer.");
    return 0;
  }
  return parsed;
}

function validatePutProgrammeBody(body = {}) {
  const errors = [];
  const expectedVersion = parseExpectedVersion(body.version);
  if (expectedVersion == null) {
    errors.push("version must be a non-negative integer.");
  }

  const siteStart = parseRequiredDate(body.siteStart, "siteStart", errors);
  const finalCompletion = parseRequiredDate(body.finalCompletion, "finalCompletion", errors);
  const firstCompletion = parseOptionalDate(body.firstCompletion, "firstCompletion", errors);
  const totalPlots = parseTotalPlots(body.totalPlots, errors);

  if (siteStart && finalCompletion && finalCompletion < siteStart) {
    errors.push("finalCompletion must be on or after siteStart.");
  }
  if (firstCompletion && siteStart && firstCompletion < siteStart) {
    errors.push("firstCompletion must be on or after siteStart.");
  }
  if (firstCompletion && finalCompletion && firstCompletion > finalCompletion) {
    errors.push("firstCompletion must be on or before finalCompletion.");
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    expectedVersion,
    value: {
      siteStart,
      firstCompletion,
      finalCompletion,
      totalPlots,
      durationMonths: inclusiveCalendarMonthCount(siteStart, finalCompletion),
    },
  };
}

module.exports = {
  parseExpectedVersion,
  validatePutProgrammeBody,
};
