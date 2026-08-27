/**
 * BL-030A — Draft payload and commercial-line validation for V1 certificates.
 */

const {
  CERTIFICATE_LINE_TYPES,
  CERTIFIABLE_EVENT_TYPES,
  FORBIDDEN_PATCH_KEYS,
  MAX_CERTIFICATE_PAYLOAD_BYTES,
  MAX_COMMERCIAL_LINES,
  MAX_LABEL_LENGTH,
  MAX_MONEY_ABS,
  MAX_PROGRESS_CELLS,
} = require("./paymentCertificateConstants");
const { roundMoney } = require("./paymentCertificateCalculations");
const {
  buildCellId,
  looksLikePositionalCellKey,
  normalizePlotKey,
  normalizeStageKey,
} = require("./paymentCertificateCellIdentity");
const { isRecoveryCommercialEvent } = require("./commercialEventConstants");

function utf8ByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeProgressEntries(rawProgress, errors) {
  const entries = [];
  if (rawProgress == null) return entries;

  const list = Array.isArray(rawProgress)
    ? rawProgress
    : typeof rawProgress === "object"
      ? Object.entries(rawProgress).map(([cellId, value]) =>
          value && typeof value === "object" ? { cellId, ...value } : { cellId, thisCertificatePct: value }
        )
      : null;

  if (!list) {
    errors.push("progress must be an object or array");
    return entries;
  }

  if (list.length > MAX_PROGRESS_CELLS) {
    errors.push(`progress cannot exceed ${MAX_PROGRESS_CELLS} cells`);
  }

  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push("each progress entry must be an object");
      continue;
    }

    if (looksLikePositionalCellKey(item.cellId) && !item.plotId && !item.plotKey) {
      errors.push(
        `progress key "${item.cellId}" is positional and is not allowed as server cell identity`
      );
      continue;
    }

    const plotKey = normalizePlotKey(item.plotId || item.plotKey);
    const stageKey = normalizeStageKey(item.stageKey || item.stageId);
    if (!plotKey || !stageKey) {
      errors.push("each progress entry requires plotId and stageKey");
      continue;
    }

    const pct = toNumber(item.thisCertificatePct);
    if (!Number.isFinite(pct)) {
      errors.push(`progress for ${plotKey} / ${stageKey} must be a finite percentage`);
      continue;
    }
    if (pct < 0 || pct > 100.005) {
      errors.push(`progress for ${plotKey} / ${stageKey} must be between 0 and 100`);
      continue;
    }

    const cellId = buildCellId(plotKey, stageKey);
    if (seen.has(cellId)) {
      errors.push(`duplicate progress cell ${plotKey} / ${stageKey}`);
      continue;
    }
    seen.add(cellId);

    if (pct === 0) continue;

    entries.push({
      cellId,
      plotId: plotKey,
      plotKey,
      stageKey,
      thisCertificatePct: roundMoney(pct),
    });
  }

  return entries;
}

function progressEntriesToPayload(entries) {
  const progress = {};
  for (const entry of entries) {
    progress[entry.cellId] = {
      plotId: entry.plotId,
      stageKey: entry.stageKey,
      thisCertificatePct: entry.thisCertificatePct,
    };
  }
  return progress;
}

function normalizeCommercialLinesInput(rawLines, errors) {
  if (rawLines == null) return [];
  if (!Array.isArray(rawLines)) {
    errors.push("commercialLines must be an array");
    return [];
  }
  if (rawLines.length > MAX_COMMERCIAL_LINES) {
    errors.push(`commercialLines cannot exceed ${MAX_COMMERCIAL_LINES}`);
  }

  return rawLines.map((line, index) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      errors.push(`commercialLines[${index}] must be an object`);
      return null;
    }
    const lineType =
      line.lineType || CERTIFICATE_LINE_TYPES.valueInclusion;
    if (
      lineType !== CERTIFICATE_LINE_TYPES.valueInclusion &&
      lineType !== CERTIFICATE_LINE_TYPES.recoveryDeduction
    ) {
      errors.push(`commercialLines[${index}].lineType is invalid`);
    }
    const amount = toNumber(line.amountThisCertificate);
    if (!Number.isFinite(amount) || Math.abs(amount) > MAX_MONEY_ABS) {
      errors.push(`commercialLines[${index}].amountThisCertificate must be a finite number`);
    }
    const commercialEventId = String(line.commercialEventId || "").trim();
    if (!commercialEventId) {
      errors.push(`commercialLines[${index}].commercialEventId is required`);
    }
    const description = String(line.description || "");
    if (description.length > MAX_LABEL_LENGTH) {
      errors.push(`commercialLines[${index}].description exceeds ${MAX_LABEL_LENGTH} characters`);
    }

    return {
      id: String(line.id || `cel-${index}`).slice(0, 80),
      commercialEventId,
      lineType,
      amountThisCertificate: Number.isFinite(amount) ? roundMoney(amount) : 0,
      sourceEventNumber: String(line.sourceEventNumber || "").slice(0, MAX_LABEL_LENGTH),
      sourceEventType: String(line.sourceEventType || "").slice(0, MAX_LABEL_LENGTH),
      description: description.slice(0, MAX_LABEL_LENGTH),
      sourceEventValue:
        line.sourceEventValue == null ? null : roundMoney(toNumber(line.sourceEventValue)),
      createdAt: line.createdAt || null,
      createdBy: line.createdBy || null,
    };
  }).filter(Boolean);
}

function collectForbiddenPatchKeys(body = {}) {
  return Object.keys(body).filter((key) => FORBIDDEN_PATCH_KEYS.has(key));
}

function validateDraftPatchBody(body = {}) {
  const errors = [];
  const forbidden = collectForbiddenPatchKeys(body);
  if (forbidden.length) {
    errors.push(`These fields cannot be patched: ${forbidden.join(", ")}`);
  }

  const progressEntries = Object.prototype.hasOwnProperty.call(body, "progress")
    ? normalizeProgressEntries(body.progress, errors)
    : null;
  const commercialLines = Object.prototype.hasOwnProperty.call(body, "commercialLines")
    ? normalizeCommercialLinesInput(body.commercialLines, errors)
    : null;

  if (body.certificateDate != null && body.certificateDate !== "") {
    const date = String(body.certificateDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push("certificateDate must be YYYY-MM-DD");
    }
  }

  const candidate = {
    progress: progressEntries ? progressEntriesToPayload(progressEntries) : undefined,
    commercialLines: commercialLines || undefined,
    certificateDate: body.certificateDate || undefined,
  };

  if (utf8ByteLength(candidate) > MAX_CERTIFICATE_PAYLOAD_BYTES) {
    errors.push("certificate payload is too large");
  }

  return {
    ok: errors.length === 0,
    errors,
    progressEntries,
    commercialLines,
    certificateDate: candidate.certificateDate,
  };
}

function isValueInclusionLine(line) {
  return !line?.lineType || line.lineType === CERTIFICATE_LINE_TYPES.valueInclusion;
}

function isRecoveryLine(line) {
  return line?.lineType === CERTIFICATE_LINE_TYPES.recoveryDeduction;
}

function certifiabilityReason(event) {
  if (!event?.id) return "Commercial event not found.";
  if (event.status !== "approved") {
    return "Only approved commercial events can be included on a certificate.";
  }
  if (isRecoveryCommercialEvent(event)) {
    return "Recovery commercial events cannot be certified on a payment certificate.";
  }
  if (event.eventType === "budgetTransfer") {
    return "Budget transfer events are internal-only and cannot be certified.";
  }
  if (!CERTIFIABLE_EVENT_TYPES.has(event.eventType)) {
    return "This commercial event type cannot be certified on a payment certificate.";
  }
  return null;
}

function recoveryEligibilityReason(event, lockedCertificates = []) {
  if (!event?.id) return "Commercial event not found.";
  if (!isRecoveryCommercialEvent(event)) {
    return "Only approved recovery events can be deducted on a payment certificate.";
  }
  const previouslyRecovered = previouslyCertifiedAmount(
    lockedCertificates,
    event.id,
    CERTIFICATE_LINE_TYPES.recoveryDeduction
  );
  const legacyClosedPartialRecovery =
    event.status === "closed" &&
    previouslyRecovered > 0 &&
    previouslyRecovered < Math.abs(Number(event.value) || 0) - Number.EPSILON &&
    !["closed", "writtenOff", "fullyRecovered"].includes(event.recoveryStatus);
  if (event.status !== "approved" && !legacyClosedPartialRecovery) {
    return "Only approved recovery events can be deducted on a payment certificate.";
  }
  const recoveryStatus = event.recoveryStatus || "notApplicable";
  if (recoveryStatus === "closed") {
    return "This recovery lifecycle is closed and cannot be deducted.";
  }
  if (recoveryStatus === "writtenOff") {
    return "Written-off recovery events cannot be deducted.";
  }
  if (recoveryStatus === "fullyRecovered") {
    return "This recovery has already been fully recovered.";
  }
  return null;
}

function previouslyCertifiedAmount(lockedCertificates, commercialEventId, lineType) {
  let sum = 0;
  for (const certificate of lockedCertificates || []) {
    for (const line of certificate.commercialLines || []) {
      if (line.commercialEventId !== commercialEventId) continue;
      if (lineType === CERTIFICATE_LINE_TYPES.recoveryDeduction) {
        if (isRecoveryLine(line)) sum += Math.abs(Number(line.amountThisCertificate) || 0);
      } else if (isValueInclusionLine(line)) {
        sum += Number(line.amountThisCertificate) || 0;
      }
    }
  }
  return roundMoney(sum);
}

function validateLinesAgainstEvents({
  lines,
  eventsById,
  packageId,
  orderKey,
  lockedCertificates,
}) {
  const errors = [];
  const seenValue = new Set();
  const seenRecovery = new Set();

  for (const line of lines || []) {
    const event = eventsById.get(line.commercialEventId);
    if (!event) {
      errors.push(
        `Commercial event ${line.sourceEventNumber || line.commercialEventId} was not found.`
      );
      continue;
    }

    const eventPackageId = event.packageUuid || event.package_id;
    const eventOrderKey = event.orderKey || event.packageId;
    if (eventPackageId && eventPackageId !== packageId && eventOrderKey !== orderKey) {
      errors.push(
        `Commercial event ${event.eventNumber || event.id} does not belong to this package.`
      );
      continue;
    }
    if (!eventPackageId && eventOrderKey && eventOrderKey !== orderKey) {
      errors.push(
        `Commercial event ${event.eventNumber || event.id} does not belong to this package.`
      );
      continue;
    }

    if (isRecoveryLine(line)) {
      if (seenRecovery.has(line.commercialEventId)) {
        errors.push(`Recovery event ${event.eventNumber || event.id} appears more than once.`);
        continue;
      }
      seenRecovery.add(line.commercialEventId);
      const reason = recoveryEligibilityReason(event, lockedCertificates);
      if (reason) {
        errors.push(`${event.eventNumber || event.id}: ${reason}`);
        continue;
      }
      const signed = roundMoney(line.amountThisCertificate);
      if (signed >= 0) {
        errors.push(
          `${event.eventNumber || event.id}: Recovery deductions must be stored as negative amounts.`
        );
        continue;
      }
      const previously = previouslyCertifiedAmount(
        lockedCertificates,
        event.id,
        CERTIFICATE_LINE_TYPES.recoveryDeduction
      );
      const remaining = roundMoney(Math.abs(Number(event.value) || 0) - previously);
      if (Math.abs(signed) > remaining + Number.EPSILON) {
        errors.push(
          `${event.eventNumber || event.id}: Amount cannot exceed the remaining recovery of £${remaining.toFixed(2)}.`
        );
      }
      if (
        line.sourceEventValue != null &&
        roundMoney(line.sourceEventValue) !== roundMoney(event.value)
      ) {
        errors.push(
          `${event.eventNumber || event.id} has changed since this line was added. Remove the line and add it again.`
        );
      }
      continue;
    }

    if (seenValue.has(line.commercialEventId)) {
      errors.push(`Commercial event ${event.eventNumber || event.id} appears more than once.`);
      continue;
    }
    seenValue.add(line.commercialEventId);
    const reason = certifiabilityReason(event);
    if (reason) {
      errors.push(`${event.eventNumber || event.id}: ${reason}`);
      continue;
    }

    const amount = roundMoney(line.amountThisCertificate);
    const source = Number(event.value) || 0;
    const previously = previouslyCertifiedAmount(
      lockedCertificates,
      event.id,
      CERTIFICATE_LINE_TYPES.valueInclusion
    );
    const remaining = roundMoney(source - previously);

    if (amount === 0) {
      errors.push(`${event.eventNumber || event.id}: Enter an amount for this certificate.`);
      continue;
    }
    if (source >= 0) {
      if (amount < 0) {
        errors.push(
          `${event.eventNumber || event.id}: Positive commercial events must use a positive certificate amount.`
        );
      } else if (amount > remaining + Number.EPSILON) {
        errors.push(
          `${event.eventNumber || event.id}: Amount cannot exceed the remaining event value of £${remaining.toFixed(2)}.`
        );
      }
    } else if (amount > 0) {
      errors.push(
        `${event.eventNumber || event.id}: Credit events must use a negative certificate amount.`
      );
    } else if (amount < remaining - Number.EPSILON) {
      errors.push(
        `${event.eventNumber || event.id}: Amount cannot exceed the remaining credit of £${remaining.toFixed(2)}.`
      );
    }

    if (
      line.sourceEventValue != null &&
      roundMoney(line.sourceEventValue) !== roundMoney(event.value)
    ) {
      errors.push(
        `${event.eventNumber || event.id} has changed since this line was added. Remove the line and add it again.`
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function parseExpectedVersion(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

module.exports = {
  utf8ByteLength,
  normalizeProgressEntries,
  progressEntriesToPayload,
  normalizeCommercialLinesInput,
  collectForbiddenPatchKeys,
  validateDraftPatchBody,
  validateLinesAgainstEvents,
  parseExpectedVersion,
  previouslyCertifiedAmount,
};
