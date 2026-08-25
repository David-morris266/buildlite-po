/**
 * BL-034B — Resolve Simple Selling Costs destination from Cost Code Master +
 * SELLING classification. Recommended code 5400 is a resolution hint only.
 */

const { query } = require("../db");
const { SEMANTIC_GROUPS } = require("./costCodeClassificationConstants");
const {
  DESTINATION_STATUSES,
  FORBIDDEN_SIMPLE_DESTINATION_CODES,
  RECOMMENDED_SIMPLE_DESTINATION_CODE,
} = require("./sellingCostsConstants");
const { normalizeDestinationKey } = require("./sellingCostsValidation");

function isForbiddenDestination(key) {
  const normalized = String(key || "").trim().toLowerCase();
  return FORBIDDEN_SIMPLE_DESTINATION_CODES.some(
    (code) => String(code).trim().toLowerCase() === normalized
  );
}

async function findCostCodeByCode(clientId, codeKey, dbClient = null) {
  const key = normalizeDestinationKey(codeKey);
  if (!key) return null;
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT id, code, description, is_active
      FROM cost_codes
      WHERE client_id = $1 AND lower(code) = lower($2)
      LIMIT 1
    `,
    [clientId, key]
  );
  return rows[0] || null;
}

async function findClassificationSemanticGroup(clientId, codeKey, dbClient = null) {
  const key = normalizeDestinationKey(codeKey);
  if (!key) return null;
  const exec = dbClient ? dbClient.query.bind(dbClient) : query;
  const { rows } = await exec(
    `
      SELECT semantic_group
      FROM cost_code_classifications
      WHERE client_id = $1 AND lower(cost_code_key) = lower($2)
      LIMIT 1
    `,
    [clientId, key]
  );
  return rows[0]?.semantic_group || null;
}

function destinationPayload({
  status,
  costCodeKey = null,
  label = null,
  semanticGroup = null,
  source = null,
  message = null,
  recommendedCode = RECOMMENDED_SIMPLE_DESTINATION_CODE,
}) {
  return {
    status,
    costCodeKey,
    label,
    semanticGroup,
    source,
    recommendedCode,
    message,
  };
}

/**
 * Resolve destination for GET proposal / PUT validation.
 * Prefer development override key; else recommended BuildLite standard code.
 */
async function resolveSellingCostsDestination(
  clientId,
  { overrideKey = null, dbClient = null } = {}
) {
  const preferredKey = normalizeDestinationKey(overrideKey);
  const candidateKey = preferredKey || RECOMMENDED_SIMPLE_DESTINATION_CODE;
  const source = preferredKey ? "development" : "recommended";

  if (!candidateKey) {
    return destinationPayload({
      status: DESTINATION_STATUSES.UNCONFIGURED,
      source,
      message: "No Selling Costs destination is configured.",
    });
  }

  if (isForbiddenDestination(candidateKey)) {
    return destinationPayload({
      status: DESTINATION_STATUSES.FORBIDDEN,
      costCodeKey: candidateKey,
      source,
      message:
        "Sales Incentives (5405) cannot be used as the Simple Selling Costs destination.",
    });
  }

  const row = await findCostCodeByCode(clientId, candidateKey, dbClient);
  if (!row) {
    return destinationPayload({
      status: DESTINATION_STATUSES.MISSING,
      costCodeKey: candidateKey,
      source,
      message: preferredKey
        ? `Destination cost code ${candidateKey} was not found on Cost Code Master.`
        : `Recommended destination ${candidateKey} is not on Cost Code Master yet.`,
    });
  }

  if (row.is_active === false) {
    return destinationPayload({
      status: DESTINATION_STATUSES.INACTIVE,
      costCodeKey: String(row.code),
      label: `${row.code} — ${row.description || ""}`.trim(),
      source,
      message: `Destination cost code ${row.code} is inactive.`,
    });
  }

  const semanticGroup = await findClassificationSemanticGroup(
    clientId,
    String(row.code),
    dbClient
  );
  const label = `${row.code} — ${row.description || ""}`.replace(/\s+—\s+$/, "").trim();

  if (semanticGroup !== SEMANTIC_GROUPS.SELLING) {
    return destinationPayload({
      status: DESTINATION_STATUSES.NOT_SELLING,
      costCodeKey: String(row.code),
      label,
      semanticGroup: semanticGroup || "UNCLASSIFIED",
      source,
      message: `Destination ${row.code} must be classified as SELLING before CVR review.`,
    });
  }

  return destinationPayload({
    status: DESTINATION_STATUSES.READY,
    costCodeKey: String(row.code),
    label,
    semanticGroup,
    source,
    message: null,
  });
}

async function assertDestinationAllowedForSave(clientId, destinationKey, dbClient = null) {
  if (destinationKey == null || destinationKey === "") {
    return { ok: true, destination: null };
  }

  const resolved = await resolveSellingCostsDestination(clientId, {
    overrideKey: destinationKey,
    dbClient,
  });

  if (resolved.status === DESTINATION_STATUSES.FORBIDDEN) {
    return { ok: false, status: 400, message: resolved.message, destination: resolved };
  }
  if (resolved.status === DESTINATION_STATUSES.MISSING) {
    return { ok: false, status: 400, message: resolved.message, destination: resolved };
  }
  if (resolved.status === DESTINATION_STATUSES.INACTIVE) {
    return { ok: false, status: 400, message: resolved.message, destination: resolved };
  }
  // NOT_SELLING: allow save of key for later classification, but surface status.
  return { ok: true, destination: resolved };
}

module.exports = {
  isForbiddenDestination,
  findCostCodeByCode,
  resolveSellingCostsDestination,
  assertDestinationAllowedForSave,
};
