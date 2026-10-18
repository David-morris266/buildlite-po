const { query } = require('../db');
const paymentAuthorityRepository = require('./paymentAuthorityRepository');
const paymentReleaseRepository = require('./paymentReleaseRepository');
const { hasPermission } = require('../auth/authorization');
const { PERMISSIONS: P } = require('../auth/permissions');

const OPEN_CE_STATUSES = ['draft', 'submitted', 'approved', 'includedInCertificate', 'recovered'];
const MAX_ATTENTION = 8;
const MAX_ACTIVITY = 10;
// Cross-workflow dates have different meanings. Priority is therefore explicit;
// timestamps only order items within the same workflow category.
const ATTENTION_PRIORITY = Object.freeze({ cvr: 0, certificate: 1, commercial_event: 2, accounts: 3 });

const ready = value => ({ state: 'ready', value });
const restricted = () => ({ state: 'restricted' });
const unavailable = () => ({ state: 'unavailable', message: 'This information is temporarily unavailable.' });
const canReadCommercial = auth => hasPermission(auth, P.COMMERCIAL_READ);

async function loadCore(clientId, run = query) {
  const result = await run(`
    SELECT
      (SELECT COUNT(*)::int FROM developments WHERE client_id=$1 AND status='live') live_developments,
      (SELECT COUNT(*)::int FROM cvr_periods WHERE client_id=$1 AND period_type='monthly_cvr' AND status='submitted') submitted_cvrs,
      (SELECT COUNT(*)::int FROM commercial_events WHERE client_id=$1 AND status=ANY($2::text[])) open_commercial_events
  `, [clientId, OPEN_CE_STATUSES]);
  return result.rows[0];
}

async function loadCvrAttention(clientId, run = query) {
  return (await run(`SELECT p.id,p.period_key,p.period_label,p.submitted_at,p.submitted_by,d.id development_id,d.development_name
    FROM cvr_periods p JOIN developments d ON d.id=p.development_id AND d.client_id=p.client_id
    WHERE p.client_id=$1 AND p.period_type='monthly_cvr' AND p.status='submitted'
    ORDER BY p.submitted_at NULLS LAST,p.id LIMIT $2`, [clientId, MAX_ATTENTION])).rows;
}

async function loadCeAttention(clientId, auth, run = query) {
  const statuses = [];
  if (hasPermission(auth, P.CE_APPROVE)) statuses.push('submitted');
  if (hasPermission(auth, P.CE_EDIT) || hasPermission(auth, P.CE_SUBMIT)) statuses.push('draft');
  if (hasPermission(auth, P.CE_CLOSE)) statuses.push('approved', 'includedInCertificate', 'recovered');
  if (!statuses.length) return [];
  return (await run(`SELECT e.id,e.event_number,e.description,e.status,e.updated_at,d.id development_id,d.development_name
    FROM commercial_events e JOIN developments d ON d.id=e.development_id AND d.client_id=e.client_id
    WHERE e.client_id=$1 AND e.status=ANY($2::text[])
    ORDER BY e.updated_at NULLS LAST,e.id LIMIT $3`,
  [clientId, [...new Set(statuses)], MAX_ATTENTION])).rows;
}

async function loadActivity(clientId, run = query) {
  return (await run(`
    WITH activity AS (
      SELECT 'cvr' kind,a.id::text source_id,a.action,a.actor,a.created_at,
        d.development_name || ' · ' || p.period_label title,d.id development_id,NULL::text reference
      FROM cvr_period_audit a JOIN cvr_periods p ON p.id=a.period_id AND p.client_id=a.client_id
      JOIN developments d ON d.id=p.development_id AND d.client_id=p.client_id WHERE a.client_id=$1
      UNION ALL
      SELECT 'certificate',a.id::text,a.action,a.actor,a.created_at,
        p.development_name || ' · Certificate ' || c.certificate_number::text,p.development_id,c.id::text
      FROM package_payment_certificate_audit a JOIN package_payment_certificates c ON c.id=a.certificate_id AND c.client_id=a.client_id
      JOIN packages p ON p.id=c.package_id AND p.client_id=c.client_id WHERE a.client_id=$1
      UNION ALL
      SELECT 'commercial_event',a.id::text,a.action,a.actor,a.created_at,
        d.development_name || ' · ' || e.event_number,d.id,e.id
      FROM commercial_event_audit a JOIN commercial_events e ON e.id=a.commercial_event_id AND e.client_id=a.client_id
      JOIN developments d ON d.id=e.development_id AND d.client_id=e.client_id WHERE a.client_id=$1
      UNION ALL
      SELECT 'purchase_order',po.po_number || ':' || history.ordinality::text,history.entry->>'action',
        history.entry->>'by',(history.entry->>'at')::timestamptz,'Purchase Order ' || po.po_number,NULL::text,po.po_number
      FROM purchase_orders po CROSS JOIN LATERAL jsonb_array_elements(COALESCE(po.payload->'approval'->'history','[]'::jsonb))
        WITH ORDINALITY history(entry,ordinality)
      WHERE po.client_id=$1 AND history.entry ? 'at' AND history.entry ? 'action'
    ) SELECT * FROM activity WHERE created_at IS NOT NULL ORDER BY created_at DESC,source_id DESC LIMIT $2
  `, [clientId, MAX_ACTIVITY])).rows;
}

function activityDestination(row) {
  if (row.kind === 'purchase_order') return { view: 'purchase-orders', poNumber: row.reference };
  if (row.kind === 'cvr') return { view: 'developments', developmentId: row.development_id, workspaceTab: 'cvr' };
  if (row.kind === 'commercial_event') return { view: 'developments', developmentId: row.development_id, workspaceTab: 'commercial' };
  return { view: 'developments', developmentId: row.development_id, workspaceTab: 'packages' };
}

function sectionState(items, failures) {
  if (!failures.length) return 'ready';
  return items.length ? 'partial' : 'unavailable';
}

function comparableTime(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function orderAttention(items) {
  return [...items].sort((a, b) => {
    const priorityDifference = (ATTENTION_PRIORITY[a.kind] ?? Number.MAX_SAFE_INTEGER) - (ATTENTION_PRIORITY[b.kind] ?? Number.MAX_SAFE_INTEGER);
    if (priorityDifference) return priorityDifference;
    return comparableTime(a.timestamp) - comparableTime(b.timestamp) || a.id.localeCompare(b.id);
  });
}

async function getHomeDashboard(auth, dependencies = {}) {
  const run = dependencies.query || query;
  const approvalQueue = dependencies.listPaymentApprovalQueue || paymentAuthorityRepository.listQueue;
  const releaseQueue = dependencies.listPaymentReleaseQueue || paymentReleaseRepository.listQueue;
  const clientId = auth.clientId;
  const commercialRead = canReadCommercial(auth);
  const coreResult = commercialRead ? await Promise.allSettled([loadCore(clientId, run)]) : [];
  const core = coreResult[0]?.status === 'fulfilled' ? coreResult[0].value : null;
  const metrics = {
    liveDevelopments: commercialRead ? (core ? ready(core.live_developments) : unavailable()) : restricted(),
    cvrAwaitingApproval: hasPermission(auth, P.CVR_LOCK) ? (core ? ready(core.submitted_cvrs) : unavailable()) : restricted(),
    certificatesRequiringReview: hasPermission(auth, P.PAYMENT_APPROVAL_RUN_VIEW) ? unavailable() : restricted(),
    openCommercialEvents: commercialRead ? (core ? ready(core.open_commercial_events) : unavailable()) : restricted(),
  };
  const attention = [];
  const failures = [];
  const tasks = [];

  if (hasPermission(auth, P.CVR_LOCK)) tasks.push(['cvr', loadCvrAttention(clientId, run)]);
  if (commercialRead) tasks.push(['commercial_events', loadCeAttention(clientId, auth, run)]);
  if (hasPermission(auth, P.PAYMENT_APPROVAL_RUN_VIEW)) tasks.push(['certificates', approvalQueue(clientId, auth)]);
  if (hasPermission(auth, P.PAYMENT_RELEASE_EXECUTE)) tasks.push(['accounts', releaseQueue(clientId, auth)]);
  const taskResults = await Promise.all(tasks.map(async ([name, promise]) => {
    try { return [name, await promise, null]; } catch { return [name, null, true]; }
  }));
  for (const [name, data, failed] of taskResults) {
    if (failed) { failures.push(name); continue; }
    if (name === 'certificates') {
      const items = data.filter(item => item.workflowState === 'awaiting_approval');
      metrics.certificatesRequiringReview = ready(items.length);
      attention.push(...items.map(item => ({ id: `certificate:${item.certificateId}`, kind: 'certificate', type: 'Certificate', title: `${item.development} · Certificate ${item.certificateNumber}`, detail: item.subcontractor, status: 'Commercial review', timestamp: item.submittedAt || null, destination: { view: 'payment-approval' } })));
    } else if (name === 'accounts') {
      attention.push(...data.filter(item => ['ready', 'needs_review'].includes(item.workflowState)).map(item => ({ id: `accounts:${item.certificateId}`, kind: 'accounts', type: 'Accounts', title: `${item.development} · Certificate ${item.certificateNumber}`, detail: item.subcontractor, status: item.workflowState === 'ready' ? 'Ready for release' : 'Needs review', timestamp: item.finalPaymentDate || null, destination: { view: 'payment-release' } })));
    } else if (name === 'cvr') {
      attention.push(...data.map(item => ({ id: `cvr:${item.id}`, kind: 'cvr', type: 'CVR', title: `${item.development_name} · ${item.period_label}`, detail: item.submitted_by ? `Submitted by ${item.submitted_by}` : 'Submitted for approval', status: 'Awaiting approval', timestamp: item.submitted_at, destination: { view: 'developments', developmentId: item.development_id, workspaceTab: 'cvr', periodKey: item.period_key } })));
    } else if (name === 'commercial_events') {
      attention.push(...data.map(item => ({ id: `ce:${item.id}`, kind: 'commercial_event', type: 'Commercial Event', title: `${item.development_name} · ${item.event_number}`, detail: item.description, status: item.status === 'submitted' ? 'Decision required' : item.status === 'draft' ? 'Draft action' : 'Eligible to close', timestamp: item.updated_at, destination: { view: 'developments', developmentId: item.development_id, workspaceTab: 'commercial' } })));
    }
  }
  if (hasPermission(auth, P.PAYMENT_APPROVAL_RUN_VIEW) && failures.includes('certificates')) metrics.certificatesRequiringReview = unavailable();

  let activity = { state: commercialRead ? 'unavailable' : 'restricted', items: [] };
  if (commercialRead) {
    try {
      const rows = await loadActivity(clientId, run);
      activity = { state: 'ready', items: rows.map(row => ({ id: `${row.kind}:${row.source_id}`, type: row.kind, title: row.title, action: row.action, actor: row.actor || null, timestamp: row.created_at, destination: activityDestination(row) })) };
    } catch { activity = { state: 'unavailable', items: [], message: 'Recent activity is temporarily unavailable.' }; }
  }
  const sortedAttention = orderAttention(attention).slice(0, MAX_ATTENTION);
  return {
    generatedAt: new Date().toISOString(),
    overview: { state: Object.values(metrics).some(item => item.state === 'unavailable') ? 'partial' : 'ready', metrics },
    attention: { state: sectionState(sortedAttention, failures), items: sortedAttention, displayLimit: MAX_ATTENTION, total: null, limitedSelection: true, unavailableSources: failures },
    activity,
  };
}

module.exports = { getHomeDashboard, loadCore, loadActivity, orderAttention, comparableTime, ATTENTION_PRIORITY, OPEN_CE_STATUSES, MAX_ATTENTION, MAX_ACTIVITY };
