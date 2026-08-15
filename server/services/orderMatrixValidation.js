/**
 * BL-029A — Plot-stage Order Matrix server validation.
 */

const {
  ORDER_MATRIX_LAYOUT,
  MAX_PAYLOAD_BYTES,
  MAX_STAGES,
  MAX_PLOTS,
  MAX_LABEL_LENGTH,
  MAX_MONEY_ABS,
} = require("./orderMatrixConstants");

const FORBIDDEN_KEYS = new Set([
  "progress",
  "certificates",
  "certificateProgress",
  "rows",
  "xlsx",
  "file",
  "fileName",
  "workbook",
]);

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function isSafeMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= MAX_MONEY_ABS;
}

function utf8ByteLength(text) {
  return Buffer.byteLength(String(text), "utf8");
}

function rejectForbiddenKeys(source, errors, prefix = "") {
  if (!source || typeof source !== "object" || Array.isArray(source)) return;
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_KEYS.has(key)) {
      errors.push(`${prefix}${key} is not allowed on an order matrix`);
    }
  }
}

function normalizeStageLabel(value, index, errors) {
  if (value == null || typeof value === "object") {
    errors.push(`stages[${index}] must be a string`);
    return "";
  }
  const label = String(value).trim();
  if (!label) {
    errors.push(`stages[${index}] must not be blank`);
    return "";
  }
  if (label.length > MAX_LABEL_LENGTH) {
    errors.push(`stages[${index}] exceeds ${MAX_LABEL_LENGTH} characters`);
  }
  return label;
}

function normalizePlot(plot, index, stageCount, errors) {
  if (!plot || typeof plot !== "object" || Array.isArray(plot)) {
    errors.push(`plots[${index}] must be an object`);
    return null;
  }

  const id = String(plot.id || "").trim();
  const label = String(plot.label || "").trim();
  if (!id) errors.push(`plots[${index}].id is required`);
  if (!label) errors.push(`plots[${index}].label is required`);
  if (id.length > MAX_LABEL_LENGTH) {
    errors.push(`plots[${index}].id exceeds ${MAX_LABEL_LENGTH} characters`);
  }
  if (label.length > MAX_LABEL_LENGTH) {
    errors.push(`plots[${index}].label exceeds ${MAX_LABEL_LENGTH} characters`);
  }

  if (!Array.isArray(plot.values)) {
    errors.push(`plots[${index}].values must be an array`);
    return {
      id: id || `plot-${index}`,
      label,
      values: [],
    };
  }

  if (plot.values.length !== stageCount) {
    errors.push(
      `plots[${index}].values length (${plot.values.length}) must match stages length (${stageCount})`
    );
  }

  const values = plot.values.map((raw, valueIndex) => {
    if (raw === "" || raw == null) {
      errors.push(`plots[${index}].values[${valueIndex}] must be a finite number`);
      return 0;
    }
    if (typeof raw === "boolean" || typeof raw === "object") {
      errors.push(`plots[${index}].values[${valueIndex}] must be a finite number`);
      return 0;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || Math.abs(n) > MAX_MONEY_ABS) {
      errors.push(`plots[${index}].values[${valueIndex}] must be a finite number`);
      return 0;
    }
    return roundMoney(n);
  });

  return {
    id: id || `plot-${index}`,
    label,
    values,
  };
}

function optionalMetadataString(value, field, errors) {
  if (value == null || value === "") return "";
  if (typeof value === "object") {
    errors.push(`${field} must be a string`);
    return "";
  }
  const text = String(value);
  if (text.length > MAX_LABEL_LENGTH) {
    errors.push(`${field} exceeds ${MAX_LABEL_LENGTH} characters`);
  }
  return text;
}

function validatePlotStageMatrix(body = {}) {
  const errors = [];
  rejectForbiddenKeys(body, errors);

  const layout = String(body.layout || "").trim();
  if (layout !== ORDER_MATRIX_LAYOUT) {
    errors.push(`layout must be "${ORDER_MATRIX_LAYOUT}"`);
  }

  if (body.committedValue != null && body.committedValue !== "") {
    if (!isSafeMoney(body.committedValue)) {
      errors.push("committedValue must be a finite number");
    }
  }

  if (!Array.isArray(body.stages)) {
    errors.push("stages must be an array of strings");
  }
  if (!Array.isArray(body.plots)) {
    errors.push("plots must be an array");
  }

  const stages = Array.isArray(body.stages)
    ? body.stages.map((stage, index) => normalizeStageLabel(stage, index, errors))
    : [];

  if (Array.isArray(body.stages) && body.stages.length === 0) {
    errors.push("stages must contain at least one payment stage");
  }
  if (stages.length > MAX_STAGES) {
    errors.push(`stages cannot exceed ${MAX_STAGES}`);
  }

  const plots = Array.isArray(body.plots)
    ? body.plots
        .map((plot, index) => normalizePlot(plot, index, stages.length, errors))
        .filter(Boolean)
    : [];

  if (Array.isArray(body.plots) && body.plots.length === 0) {
    errors.push("plots must contain at least one plot");
  }
  if (plots.length > MAX_PLOTS) {
    errors.push(`plots cannot exceed ${MAX_PLOTS}`);
  }

  const payload = {
    stages,
    plots,
    jobId: optionalMetadataString(body.jobId, "jobId", errors),
    supplierId: optionalMetadataString(body.supplierId, "supplierId", errors),
    projectLabel: optionalMetadataString(body.projectLabel, "projectLabel", errors),
    supplierLabel: optionalMetadataString(body.supplierLabel, "supplierLabel", errors),
  };

  const payloadBytes = utf8ByteLength(JSON.stringify(payload));
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    errors.push(`matrix payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }

  const committedValue =
    body.committedValue == null || body.committedValue === ""
      ? null
      : isSafeMoney(body.committedValue)
        ? roundMoney(body.committedValue)
        : null;

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      layout: ORDER_MATRIX_LAYOUT,
      committedValue,
      payload,
    },
  };
}

module.exports = {
  validatePlotStageMatrix,
  roundMoney,
  utf8ByteLength,
};
