/**
 * BL-034B — Validate Selling Costs assumption PUT bodies.
 */

const {
  DEFAULT_ASSUMPTION_PERCENT,
  MAX_ASSUMPTION_PERCENT,
  MAX_DESTINATION_KEY_LENGTH,
  SELLING_COSTS_MODES,
  SELLING_COSTS_MODE_KEYS,
} = require("./sellingCostsConstants");

function parseExpectedVersion(value) {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function normalizeDestinationKey(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  let codePart = raw.split("—")[0].split(" – ")[0];
  const spacedHyphen = codePart.split(" - ");
  if (spacedHyphen.length > 1) codePart = spacedHyphen[0];
  const key = codePart.replace(/\s+/g, "").trim().slice(0, MAX_DESTINATION_KEY_LENGTH);
  return key || null;
}

/**
 * Percentages are stored to 4 dp; commercial display uses 2 dp.
 * Rejects negatives, non-finite, and technical overflow (> 1000).
 */
function parseAssumptionPercent(value) {
  if (value == null || value === "") {
    return { ok: false, error: "assumptionPercent is required." };
  }
  const amount = Number(String(value).replace(/%/g, "").trim());
  if (!Number.isFinite(amount)) {
    return { ok: false, error: "assumptionPercent must be a finite number." };
  }
  if (amount < 0) {
    return { ok: false, error: "assumptionPercent must not be negative." };
  }
  if (amount > MAX_ASSUMPTION_PERCENT) {
    return {
      ok: false,
      error: `assumptionPercent must not exceed ${MAX_ASSUMPTION_PERCENT} (technical limit).`,
    };
  }
  const rounded = Math.round((amount + Number.EPSILON) * 10000) / 10000;
  return { ok: true, value: rounded };
}

function validatePutAssumptionBody(body = {}) {
  const errors = [];
  const expectedVersion = parseExpectedVersion(body.version ?? body.expectedVersion);
  if (expectedVersion == null) {
    errors.push("version must be a non-negative integer.");
  }

  const modeRaw = body.mode != null ? String(body.mode).trim().toLowerCase() : SELLING_COSTS_MODES.SIMPLE;
  if (!SELLING_COSTS_MODE_KEYS.includes(modeRaw)) {
    errors.push("mode must be simple or detailed.");
  }
  if (modeRaw === SELLING_COSTS_MODES.DETAILED) {
    errors.push("Detailed Selling Costs mode is not available yet.");
  }

  const clearAssumption=body.useCompanyAssumption===true;
  const assumptionProvided=clearAssumption||Object.prototype.hasOwnProperty.call(body,'assumptionPercent')||Object.prototype.hasOwnProperty.call(body,'assumption_percent');
  const percentParsed=clearAssumption?{ok:true,value:null}:assumptionProvided?parseAssumptionPercent(body.assumptionPercent ?? body.assumption_percent):{ok:true,value:undefined};
  if(!percentParsed.ok)errors.push(percentParsed.error);

  let destinationKey = undefined;
  let destinationId = undefined;
  if(body.useCompanyDestination===true){destinationId=null;destinationKey=null;}
  else if(Object.prototype.hasOwnProperty.call(body,'destinationCostCodeId')){
    const raw=body.destinationCostCodeId;destinationId=raw==null||raw===''?null:String(raw).trim();
    if(destinationId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(destinationId))errors.push('destinationCostCodeId must be a valid UUID.');
  }
  if (
    Object.prototype.hasOwnProperty.call(body, "destinationCostCodeKey") ||
    Object.prototype.hasOwnProperty.call(body, "destination_cost_code_key")
  ) {
    const raw =
      body.destinationCostCodeKey !== undefined
        ? body.destinationCostCodeKey
        : body.destination_cost_code_key;
    if (raw === null || raw === "") {
      destinationKey = null;
    } else {
      destinationKey = normalizeDestinationKey(raw);
      if (!destinationKey) {
        errors.push("destinationCostCodeKey is invalid.");
      }
    }
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    expectedVersion,
    value: {
      mode: SELLING_COSTS_MODES.SIMPLE,
      assumptionPercent: percentParsed.value,
      assumptionProvided,
      destinationCostCodeKey: destinationKey,
      destinationCostCodeId: destinationId,
      destinationProvided: destinationKey !== undefined || destinationId !== undefined,
    },
  };
}

module.exports = {
  parseExpectedVersion,
  normalizeDestinationKey,
  parseAssumptionPercent,
  validatePutAssumptionBody,
};
