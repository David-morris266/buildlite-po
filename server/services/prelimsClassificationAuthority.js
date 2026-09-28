const { query } = require('../db');
const { listClassifications } = require('./costCodeClassificationRepository');
const { SEMANTIC_GROUPS } = require('./costCodeClassificationConstants');

function resolveEffectivePrelimsClassification({ costCodeKey, classification = null, costCode = null } = {}) {
  const category = costCode?.head_active === true ? costCode.buildlite_category || null : null;
  if (category) {
    return {
      costCodeKey,
      exists: true,
      semanticGroup: category === 'PRELIMINARIES' ? SEMANTIC_GROUPS.PRELIMS : category,
      authority: 'commercial_head_category',
      buildliteCategory: category,
    };
  }
  return classification || {
    costCodeKey,
    exists: false,
    semanticGroup: SEMANTIC_GROUPS.UNCLASSIFIED,
    forecastDriver: 'STANDARD_CVR',
    authority: 'legacy_default',
  };
}

async function listEffectivePrelimsClassifications(clientId, dbClient = null) {
  const run = dbClient?.query ? dbClient.query.bind(dbClient) : query;
  const [legacy, codes] = await Promise.all([
    listClassifications(clientId, dbClient),
    run(`SELECT c.code,h.is_active head_active,h.buildlite_category
      FROM cost_codes c
      LEFT JOIN commercial_structure_heads h ON h.client_id=c.client_id AND h.id=c.commercial_head_id
      WHERE c.client_id=$1`, [clientId]),
  ]);
  const legacyByKey = new Map((legacy.classifications || []).map((row) => [String(row.costCodeKey).trim().toLowerCase(), row]));
  const effective = codes.rows.map((costCode) => {
    const key = String(costCode.code || '').trim();
    return resolveEffectivePrelimsClassification({ costCodeKey: key, classification: legacyByKey.get(key.toLowerCase()) || null, costCode });
  });
  const present = new Set(effective.map((row) => String(row.costCodeKey).toLowerCase()));
  for (const row of legacy.classifications || []) if (!present.has(String(row.costCodeKey).toLowerCase())) effective.push(row);
  return { ok: true, classifications: effective };
}

module.exports = { resolveEffectivePrelimsClassification, listEffectivePrelimsClassifications };
