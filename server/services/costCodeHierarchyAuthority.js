const crypto = require('crypto');
const { PERMISSIONS } = require('../auth/permissions');

const STATES = Object.freeze({ MATCHED: 'MATCHED', NEW: 'NEW_STRUCTURE_REQUIRED', AMBIGUOUS: 'AMBIGUOUS', UNALLOCATED: 'UNALLOCATED', INVALID: 'INVALID', ARCHIVED: 'ARCHIVED_MATCH' });
const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const key = (value) => clean(value).toLocaleLowerCase('en-GB');

function reviewSecret() {
  const configured = process.env.COST_CODE_IMPORT_REVIEW_SECRET || process.env.CLERK_SECRET_KEY || process.env.DATABASE_URL;
  if (!configured) throw Object.assign(Error('Cost Code hierarchy review signing is unavailable.'), { status: 503 });
  return crypto.createHash('sha256').update(`buildlite-cost-code-hierarchy-review-v1\0${configured}`).digest();
}

function signEvidence(domain, evidence) {
  return crypto.createHmac('sha256', reviewSecret()).update(`${domain}\0${JSON.stringify(evidence)}`).digest('hex');
}

function evidenceMatches(domain, evidence, token) {
  if (typeof token !== 'string' || token.length !== 64) return false;
  const expected = Buffer.from(signEvidence(domain, evidence), 'hex');
  const actual = Buffer.from(token, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function catalogueToken(structure) {
  const compact = ['heads', 'families', 'reportingGroups'].flatMap((type) => (structure[type] || []).map((item) => [type, item.id, item.headId || '', item.familyId || '', item.name, item.active, item.version]));
  return crypto.createHash('sha256').update(JSON.stringify(compact)).digest('hex');
}

async function loadHierarchyAuthority(db, clientId, { lock = false } = {}) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [heads, families, groups, codes] = await Promise.all([
    db.query(`SELECT id,name,is_active,version,display_order FROM commercial_structure_heads WHERE client_id=$1 ORDER BY id${suffix}`, [clientId]),
    db.query(`SELECT id,head_id,name,is_active,version,display_order FROM commercial_structure_families WHERE client_id=$1 ORDER BY id${suffix}`, [clientId]),
    db.query(`SELECT id,head_id,family_id,name,is_active,version,display_order FROM commercial_structure_reporting_groups WHERE client_id=$1 ORDER BY id${suffix}`, [clientId]),
    db.query(`SELECT * FROM cost_codes WHERE client_id=$1 ORDER BY id${suffix}`, [clientId]),
  ]);
  return {
    heads: heads.rows.map((row) => ({ id: row.id, name: row.name, active: row.is_active, version: Number(row.version), displayOrder: Number(row.display_order) })),
    families: families.rows.map((row) => ({ id: row.id, headId: row.head_id, name: row.name, active: row.is_active, version: Number(row.version), displayOrder: Number(row.display_order) })),
    reportingGroups: groups.rows.map((row) => ({ id: row.id, headId: row.head_id, familyId: row.family_id || null, name: row.name, active: row.is_active, version: Number(row.version), displayOrder: Number(row.display_order) })),
    costCodes: codes.rows,
  };
}

function matches(rows, name, predicate = () => true) { return rows.filter((item) => key(item.name) === key(name) && predicate(item)); }

function resolvePath(structure, input) {
  const commercialHead = clean(input.commercialHead); const commercialFamily = clean(input.commercialFamily); const reportingGroup = clean(input.reportingGroup || input.trade);
  if (!commercialHead && !commercialFamily && !reportingGroup) return { state: STATES.UNALLOCATED, path: { commercialHeadId: null, commercialFamilyId: null, reportingGroupId: null }, labels: { commercialHead: '', commercialFamily: '', reportingGroup: '' } };
  if (!commercialHead || !reportingGroup) return { state: STATES.INVALID, reason: 'Commercial Head and Reporting Group are both required for an allocated row.' };
  const heads = matches(structure.heads, commercialHead); if (heads.length > 1) return { state: STATES.AMBIGUOUS, reason: 'Commercial Head is ambiguous.' };
  const head = heads[0]; if (head && !head.active) return { state: STATES.ARCHIVED, reason: 'Commercial Head is archived.' };
  if (!head) return { state: STATES.NEW, proposal: { commercialHead, commercialFamily, reportingGroup }, labels: { commercialHead, commercialFamily, reportingGroup } };
  let family = null;
  if (commercialFamily) {
    const families = matches(structure.families, commercialFamily, (item) => item.headId === head.id);
    if (families.length > 1) return { state: STATES.AMBIGUOUS, reason: 'Commercial Family is ambiguous.' };
    family = families[0]; if (family && !family.active) return { state: STATES.ARCHIVED, reason: 'Commercial Family is archived.' };
    if (!family) return { state: STATES.NEW, proposal: { commercialHead, commercialFamily, reportingGroup }, existing: { commercialHeadId: head.id, commercialHeadVersion: head.version }, labels: { commercialHead: head.name, commercialFamily, reportingGroup } };
  }
  const groups = matches(structure.reportingGroups, reportingGroup, (item) => item.headId === head.id && (item.familyId || null) === (family?.id || null));
  if (groups.length > 1) return { state: STATES.AMBIGUOUS, reason: 'Reporting Group is ambiguous.' };
  const group = groups[0]; if (group && !group.active) return { state: STATES.ARCHIVED, reason: 'Reporting Group is archived.' };
  if (!group) return { state: STATES.NEW, proposal: { commercialHead, commercialFamily, reportingGroup }, existing: { commercialHeadId: head.id, commercialHeadVersion: head.version, ...(family ? { commercialFamilyId: family.id, commercialFamilyVersion: family.version } : {}) }, labels: { commercialHead: head.name, commercialFamily: family?.name || '', reportingGroup } };
  return { state: STATES.MATCHED, path: { commercialHeadId: head.id, commercialFamilyId: family?.id || null, reportingGroupId: group.id }, versions: { commercialHead: head.version, commercialFamily: family?.version || null, reportingGroup: group.version }, labels: { commercialHead: head.name, commercialFamily: family?.name || '', reportingGroup: group.name } };
}

function consolidateProposals(rows) {
  const proposals = [];
  for (const row of rows.filter((item) => item.resolution?.state === STATES.NEW)) {
    const proposal = row.resolution.proposal; const proposalKey = [key(proposal.commercialHead), key(proposal.commercialFamily), key(proposal.reportingGroup)].join('::');
    let item = proposals.find((candidate) => candidate.key === proposalKey);
    if (!item) { item = { key: proposalKey, ...proposal, costCodes: [] }; proposals.push(item); }
    item.costCodes.push(row.code);
  }
  return proposals;
}

async function auditStructureCreate(db, clientId, type, row, auth) {
  await db.query(`INSERT INTO commercial_structure_audit(client_id,entity_type,entity_id,operation,after_document,resulting_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name,actor_role_key,actor_permission_key) VALUES($1,$2,$3,'create',$4,$5,$6,$7,$8,$9,$10,$11)`, [clientId, type, row.id, JSON.stringify({ id: row.id, name: row.name, headId: row.head_id || null, familyId: row.family_id || null, displayOrder: Number(row.display_order), active: row.is_active, version: Number(row.version), origin: row.origin }), row.version, auth.userId, auth.membershipId, auth.providerUserId, auth.displayName, auth.roleKey, PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE]);
}

async function createPath(db, clientId, proposal, auth, origin = 'cost_code_import') {
  let head = (await db.query('SELECT * FROM commercial_structure_heads WHERE client_id=$1 AND lower(btrim(name))=lower(btrim($2)) FOR UPDATE', [clientId, proposal.commercialHead])).rows[0];
  if (!head) { head = (await db.query(`INSERT INTO commercial_structure_heads(client_id,name,display_order,origin,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name) VALUES($1,$2,(SELECT count(*) FROM commercial_structure_heads WHERE client_id=$1),$3,$4,$5,$6,$7) RETURNING *`, [clientId, proposal.commercialHead, origin, auth.userId, auth.membershipId, auth.providerUserId, auth.displayName])).rows[0]; await auditStructureCreate(db, clientId, 'head', head, auth); }
  if (!head.is_active) throw Object.assign(Error('Reviewed Commercial Head is now archived.'), { status: 409 });
  let family = null;
  if (proposal.commercialFamily) {
    family = (await db.query('SELECT * FROM commercial_structure_families WHERE client_id=$1 AND head_id=$2 AND lower(btrim(name))=lower(btrim($3)) FOR UPDATE', [clientId, head.id, proposal.commercialFamily])).rows[0];
    if (!family) { family = (await db.query(`INSERT INTO commercial_structure_families(client_id,head_id,name,display_order,origin,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name) VALUES($1,$2,$3,(SELECT count(*) FROM commercial_structure_families WHERE client_id=$1 AND head_id=$2),$4,$5,$6,$7,$8) RETURNING *`, [clientId, head.id, proposal.commercialFamily, origin, auth.userId, auth.membershipId, auth.providerUserId, auth.displayName])).rows[0]; await auditStructureCreate(db, clientId, 'family', family, auth); }
    if (!family.is_active) throw Object.assign(Error('Reviewed Commercial Family is now archived.'), { status: 409 });
  }
  let group = (await db.query('SELECT * FROM commercial_structure_reporting_groups WHERE client_id=$1 AND head_id=$2 AND family_id IS NOT DISTINCT FROM $3 AND lower(btrim(name))=lower(btrim($4)) FOR UPDATE', [clientId, head.id, family?.id || null, proposal.reportingGroup])).rows[0];
  if (!group) { group = (await db.query(`INSERT INTO commercial_structure_reporting_groups(client_id,head_id,family_id,name,display_order,origin,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name) VALUES($1,$2,$3,$4,(SELECT count(*) FROM commercial_structure_reporting_groups WHERE client_id=$1 AND head_id=$2 AND family_id IS NOT DISTINCT FROM $3),$5,$6,$7,$8,$9) RETURNING *`, [clientId, head.id, family?.id || null, proposal.reportingGroup, origin, auth.userId, auth.membershipId, auth.providerUserId, auth.displayName])).rows[0]; await auditStructureCreate(db, clientId, 'reporting_group', group, auth); }
  if (!group.is_active) throw Object.assign(Error('Reviewed Reporting Group is now archived.'), { status: 409 });
  return { h: head, f: family, g: group };
}

module.exports = { STATES, clean, key, signEvidence, evidenceMatches, catalogueToken, loadHierarchyAuthority, resolvePath, consolidateProposals, createPath };
