/**
 * BL-033C — Map development_programme rows and GET-time payload seeds.
 * GET never inserts. firstCompletion is never seeded from Plot Master.
 */

const { inclusiveCalendarMonthCount, toIsoDate } = require("./programmeCalendar");

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parsePlotCount(value) {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

function emptyProgrammeDocument(developmentId) {
  return {
    id: null,
    developmentId,
    exists: false,
    siteStart: null,
    firstCompletion: null,
    finalCompletion: null,
    totalPlots: 0,
    durationMonths: null,
    version: 0,
    createdAt: null,
    updatedAt: null,
    createdBy: null,
    updatedBy: null,
  };
}

function seedProgrammeFromDevelopment(development = {}) {
  const developmentId = development.id || development.developmentId || null;
  const siteStart = toIsoDate(development.startDate);
  const finalCompletion = toIsoDate(development.targetCompletion);
  return {
    ...emptyProgrammeDocument(developmentId),
    siteStart,
    firstCompletion: null,
    finalCompletion,
    totalPlots: parsePlotCount(development.plotCount),
    durationMonths: inclusiveCalendarMonthCount(siteStart, finalCompletion),
  };
}

function programmeRowToDocument(row, developmentId) {
  if (!row) return emptyProgrammeDocument(developmentId);
  const siteStart = toDateOnly(row.site_start);
  const firstCompletion = toDateOnly(row.first_completion);
  const finalCompletion = toDateOnly(row.final_completion);
  return {
    id: row.id,
    developmentId: row.development_id,
    exists: true,
    siteStart,
    firstCompletion,
    finalCompletion,
    totalPlots: Number(row.total_plots) || 0,
    durationMonths: inclusiveCalendarMonthCount(siteStart, finalCompletion),
    version: Number(row.version) || 1,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

module.exports = {
  emptyProgrammeDocument,
  seedProgrammeFromDevelopment,
  programmeRowToDocument,
  parsePlotCount,
  toDateOnly,
};
