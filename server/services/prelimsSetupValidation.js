/**
 * BL-033D.x.3 — Validate development Prelims setup apply bodies.
 * Preview-only mapping lives on the request; it does not write the company template.
 */

const { parseExpectedVersion, preserveCostCodeKey } = require("./prelimsItemValidation");
const { PRELIMS_DRIVER_KEYS } = require("./prelimsConstants");

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function parseOptionalDriver(value, index, errors) {
  if (value == null || value === "") return null;
  const driver = String(value).trim();
  if (!PRELIMS_DRIVER_KEYS.includes(driver)) {
    errors.push(`lines[${index}].forecastDriver must be TIME or LUMP_SUM.`);
    return null;
  }
  return driver;
}

function validatePrelimsSetupApplyBody(body = {}) {
  const errors = [];
  const templateId = String(body.templateId || "").trim();
  if (!isUuid(templateId)) errors.push("templateId must be a valid UUID.");

  const templateVersion = parseExpectedVersion(body.templateVersion);
  if (templateVersion == null || templateVersion < 1) {
    errors.push("templateVersion must be a positive integer.");
  }

  if (!Array.isArray(body.lines)) {
    errors.push("lines must be an array.");
    return { ok: false, errors };
  }

  const selected = [];
  const seen = new Set();
  for (const [index, line] of body.lines.entries()) {
    if (!line || line.selected !== true) continue;
    const templateLineId = String(line.templateLineId || "").trim();
    if (!isUuid(templateLineId)) {
      errors.push(`lines[${index}].templateLineId must be a valid UUID.`);
      continue;
    }
    if (seen.has(templateLineId)) continue;
    seen.add(templateLineId);
    selected.push({
      templateLineId,
      costCodeKey: preserveCostCodeKey(line.costCodeKey),
      forecastDriver: parseOptionalDriver(line.forecastDriver, index, errors),
      monthlyRate: line.monthlyRate,
      lumpSumAmount: line.lumpSumAmount,
      startBasis: line.startBasis,
      startOffsetMonths: line.startOffsetMonths,
      startFixedDate: line.startFixedDate,
      endBasis: line.endBasis,
      endOffsetMonths: line.endOffsetMonths,
      endFixedDate: line.endFixedDate,
    });
  }

  if (errors.length) return { ok: false, errors };
  if (!selected.length) {
    return { ok: false, errors: ["Select at least one ready line."] };
  }

  return {
    ok: true,
    value: {
      templateId,
      templateVersion,
      lines: selected,
    },
  };
}

module.exports = {
  isUuid,
  validatePrelimsSetupApplyBody,
};
