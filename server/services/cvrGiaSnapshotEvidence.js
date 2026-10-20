const GIA_EVIDENCE_SCHEMA_VERSION = 1;

function decimalToScale4(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const text = String(raw).trim();
  if (text.length > 128) return null;
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return null;
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 32) return null;
  const negative = match[1] === "-";
  const digits = `${match[2]}${match[3] || ""}`.replace(/^0+(?=\d)/, "");
  const decimalPlaces = (match[3] || "").length - exponent;
  const shift = 4 - decimalPlaces;
  let units;
  if (shift >= 0) {
    units = BigInt(digits || "0") * (10n ** BigInt(shift));
  } else {
    const divisor = 10n ** BigInt(-shift);
    const whole = BigInt(digits || "0");
    units = whole / divisor;
    if ((whole % divisor) * 2n >= divisor) units += 1n;
  }
  return negative ? -units : units;
}

function scale4ToDecimal(units) {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const text = absolute.toString().padStart(5, "0");
  return `${negative ? "-" : ""}${text.slice(0, -4)}.${text.slice(-4)}`;
}

function isActivePlot(plot) {
  return String(plot?.status || "").trim().toLowerCase() !== "inactive";
}

function giaValue(raw) {
  if (raw == null || String(raw).trim() === "") return { value: null, valid: false, reason: "missing" };
  const text = String(raw).trim();
  const exponentMatch = text.match(/[eE]([+-]?\d+)$/);
  if (text.length > 128 || (exponentMatch && Math.abs(Number(exponentMatch[1])) > 32)) {
    return { value: null, units: null, valid: false, reason: "out_of_range" };
  }
  const units = decimalToScale4(raw);
  if (units == null) return { value: null, units: null, valid: false, reason: "not_numeric" };
  if (units > 9999999999999999n || units < -9999999999999999n) {
    return { value: null, units: null, valid: false, reason: "out_of_range" };
  }
  const value = scale4ToDecimal(units);
  if (units <= 0n) return { value, units, valid: false, reason: "non_positive" };
  return { value, units, valid: true, reason: null };
}

function buildCvrGiaSnapshotEvidence(development) {
  const plots = development?.plotMaster?.plots;
  if (!Array.isArray(plots)) {
    return {
      evidenceSchemaVersion: GIA_EVIDENCE_SCHEMA_VERSION,
      availabilityState: "plot_master_missing",
      totalPlotCount: 0,
      activePlotCount: 0,
      activePlotGiaCount: 0,
      capturedValidActiveGia: 0,
      totalActiveGia: null,
      plots: [],
    };
  }

  const sourceKeys = plots.map((plot) => {
    const id = String(plot?.id || "").trim();
    if (id) return `id:${id}`;
    const number = String(plot?.plotNumber || "").trim();
    return number ? `number:${number}` : null;
  });
  const sourceKeyCounts = new Map();
  sourceKeys.filter(Boolean).forEach((key) => sourceKeyCounts.set(key, (sourceKeyCounts.get(key) || 0) + 1));
  const rows = plots.map((plot, index) => {
    const raw = plot?.gia;
    const parsed = giaValue(raw);
    const sourcePlotId = String(plot?.id || "").trim() || null;
    return {
      plotId: `plot-index:${index}`,
      sourceIndex: index,
      sourcePlotId,
      sourceIdentityDuplicate: Boolean(sourceKeys[index] && sourceKeyCounts.get(sourceKeys[index]) > 1),
      sourceIdentityOversized: Boolean(sourcePlotId && sourcePlotId.length > 128),
      plotNumber: String(plot?.plotNumber || "").trim(),
      active: isActivePlot(plot),
      originalGiaRaw: raw == null ? null : String(raw),
      originalGia: parsed.value,
      originalGiaUnits: parsed.units,
      giaValid: parsed.valid,
      invalidReason: parsed.reason,
    };
  });
  const active = rows.filter((row) => row.active);
  const validActive = active.filter((row) => row.giaValid);
  const capturedValidActiveGiaUnits = validActive.reduce((sum, row) => sum + row.originalGiaUnits, 0n);
  const complete = active.length > 0 && validActive.length === active.length;
  const totalOutOfRange = capturedValidActiveGiaUnits > 9999999999999999n;
  return {
    evidenceSchemaVersion: GIA_EVIDENCE_SCHEMA_VERSION,
    availabilityState: active.length === 0
      ? "no_active_plots"
      : totalOutOfRange ? "total_out_of_range" : complete ? "complete" : "incomplete",
    totalPlotCount: rows.length,
    activePlotCount: active.length,
    activePlotGiaCount: validActive.length,
    capturedValidActiveGia: totalOutOfRange ? null : scale4ToDecimal(capturedValidActiveGiaUnits),
    totalActiveGia: complete && !totalOutOfRange ? scale4ToDecimal(capturedValidActiveGiaUnits) : null,
    plots: rows.map(({ originalGiaUnits, ...row }) => row),
  };
}

module.exports = { GIA_EVIDENCE_SCHEMA_VERSION, buildCvrGiaSnapshotEvidence, decimalToScale4, scale4ToDecimal };
