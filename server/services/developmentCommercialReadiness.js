const db = require('../db');
const { verifyJsonIntegrity } = require('./canonicalJsonIntegrity');
const { buildCvrRevenueCloseCandidate } = require('./cvrRevenueClose');
const { buildLiveVariationExposure } = require('./cvrVariationExposureSnapshot');

const STATES = Object.freeze({ BLOCKER: 'blocker', ATTENTION: 'needs_attention', READY: 'ready' });
const DRAFT_CREATION_REQUIREMENT_KEYS = new Set(['cost_code_master', 'development_budget']);

function item(key, state, title, reason, resolutionTarget, detail = {}) {
  return { key, state, title, reason, resolutionTarget, ...detail };
}

function sourceUnavailable(key, title, resolutionTarget) {
  return item(key, STATES.BLOCKER, title, `${title} could not be checked.`, resolutionTarget, { sourceAvailable: false });
}

function evaluateDevelopmentCommercialReadiness(facts = {}) {
  const items = [];
  const costCodes = facts.costCodes;
  const periods = facts.periods;
  const budget = facts.budget;
  const establishedLegacy = Boolean(periods?.rows?.some(period => period.budgetSource === 'legacy_cvr'));
  const openPeriod = periods?.rows?.find(period => ['draft', 'submitted'].includes(period.status));

  if (!costCodes?.available) items.push(sourceUnavailable('cost_code_master', 'Cost Code Master', { view: 'administration', section: 'cost-codes' }));
  else if (!costCodes.activeCount) items.push(item('cost_code_master', STATES.BLOCKER, 'Cost Code Master', 'No active company cost codes are available.', { view: 'administration', section: 'cost-codes' }, { count: 0 }));
  else items.push(item('cost_code_master', STATES.READY, 'Cost Code Master', `${costCodes.activeCount} active cost codes available.`, { view: 'administration', section: 'cost-codes' }, { count: costCodes.activeCount }));

  if (!periods?.available) items.push(sourceUnavailable('cvr_periods', 'CVR periods', { tab: 'cvr' }));
  else if (openPeriod) items.push(item('cvr_periods', STATES.ATTENTION, 'CVR in progress', `${openPeriod.periodKey} is ${openPeriod.status}. Continue the current CVR before creating another.`, { tab: 'cvr', periodKey: openPeriod.periodKey }, { openPeriod, workflowState: true, preventsPeriodCreation: true }));
  else items.push(item('cvr_periods', STATES.READY, 'CVR periods', periods.rows.length ? 'No open CVR period.' : 'Ready to create the first CVR period.', { tab: 'cvr' }, { count: periods.rows.length }));

  if (!budget?.available) items.push(sourceUnavailable('development_budget', 'Development Budget', { tab: 'budget' }));
  else if (!budget.exists || !budget.integrityValid) {
    const state = establishedLegacy && !budget.exists ? STATES.ATTENTION : STATES.BLOCKER;
    const reason = !budget.integrityValid && budget.exists
      ? 'Development Budget integrity could not be verified.'
      : establishedLegacy
        ? 'This established development still uses its compatible legacy CVR budget workflow.'
        : 'Establish the approved Development Budget before creating the first CVR.';
    items.push(item('development_budget', state, 'Development Budget', reason, { tab: 'budget' }, { exists: Boolean(budget.exists), integrityValid: Boolean(budget.integrityValid) }));
  } else items.push(item('development_budget', STATES.READY, 'Development Budget', 'Authoritative Development Budget is established and verified.', { tab: 'budget' }));

  const revenue = facts.revenue;
  if (!revenue?.available) items.push(sourceUnavailable('revenue', 'Revenue', { tab: 'revenue' }));
  else if (!revenue.ready) items.push(item('revenue', STATES.ATTENTION, 'Revenue', revenue.reason || 'Revenue needs to be completed before this CVR can be finalised.', { tab: revenue.plotMasterMissing ? 'plot-master' : 'revenue' }, { blocksCompletion: true }));
  else if (!revenue.plotCount || revenue.sparse) items.push(item('revenue', STATES.ATTENTION, 'Revenue', 'Revenue is available but the current Plot Master or pricing position is commercially sparse.', { tab: 'revenue' }, { count: revenue.plotCount || 0 }));
  else items.push(item('revenue', STATES.READY, 'Revenue', 'Revenue sources are configured.', { tab: 'revenue' }, { count: revenue.plotCount }));

  const plotTenure=facts.plotTenure;
  if(!plotTenure?.available)items.push(item('plot_tenure',STATES.ATTENTION,'Plot Master tenure classifications','Plot Master tenure readiness could not be checked.',{tab:'plot-master',plotMasterView:'tenure-review'},{sourceAvailable:false}));
  else if(plotTenure.missing)items.push(item('plot_tenure',STATES.ATTENTION,'Plot Master tenure classifications','Plot Master is missing or empty.',{tab:'plot-master'}));
  else if(plotTenure.needsAttention)items.push(item('plot_tenure',STATES.ATTENTION,'Plot Master tenure classifications',`${plotTenure.reviewed} of ${plotTenure.total} reviewed · ${plotTenure.needsAttention} need attention.`,{tab:'plot-master',plotMasterView:'tenure-review'},{count:plotTenure.total}));
  else items.push(item('plot_tenure',STATES.READY,'Plot Master tenure classifications',`${plotTenure.total} of ${plotTenure.total} reviewed.`,{tab:'plot-master',plotMasterView:'tenure-review'},{count:plotTenure.total}));

  const va = facts.variationExposure;
  if (!va?.available) items.push(sourceUnavailable('variation_exposure', 'Variation exposure', { tab: 'commercial' }));
  else if (va.blockers?.length) items.push(item('variation_exposure', STATES.BLOCKER, 'Variation exposure', `${va.blockers.length} variation ${va.blockers.length === 1 ? 'item requires' : 'items require'} attention before Submit.`, { tab: 'commercial' }, { blocksCompletion: true, blockers: va.blockers }));
  else items.push(item('variation_exposure', STATES.READY, 'Variation exposure', va.itemCount ? `${va.itemCount} variation items are calculable.` : 'No Variation Account exposure recorded.', { tab: 'commercial' }, { count: va.itemCount || 0 }));

  const simpleCounts = [
    ['purchase_orders', 'Purchase commitments', facts.purchaseOrders, 'No purchase commitments recorded; this may be a legitimate zero position.', { view: 'purchase-orders' }],
    ['packages', 'Packages', facts.packages, 'No subcontract packages recorded; this may be a legitimate zero position.', { tab: 'packages' }],
    ['certificates', 'Certificates', facts.certificates, 'No certificates recorded; this may be a legitimate zero position.', { tab: 'packages' }],
    ['commercial_events', 'Commercial Events / VOs', facts.commercialEvents, 'No Commercial Events or Variation Orders recorded.', { tab: 'commercial' }],
  ];
  for (const [key, title, source, emptyReason, target] of simpleCounts) {
    if (!source?.available) items.push(sourceUnavailable(key, title, target));
    else items.push(item(key, STATES.READY, title, source.count ? `${source.count} recorded.` : emptyReason, target, { count: source.count || 0 }));
  }

  if (!facts.ledger?.available) items.push(sourceUnavailable('ledger', 'Purchase ledger', { tab: 'ledger' }));
  else if (!facts.ledger.count) items.push(item('ledger', STATES.ATTENTION, 'Purchase ledger', 'No ledger transactions are recorded. Confirm whether £0 actual cost is complete.', { tab: 'ledger' }, { count: 0 }));
  else items.push(item('ledger', STATES.READY, 'Purchase ledger', `${facts.ledger.count} transactions recorded.`, { tab: 'ledger' }, { count: facts.ledger.count }));

  for (const [key, title, source, tab] of [
    ['prelims', 'Prelims', facts.prelims, 'prelims'],
    ['selling_costs', 'Selling Costs', facts.sellingCosts, 'selling-costs'],
  ]) {
    if (!source?.available) items.push(sourceUnavailable(key, title, { tab }));
    else if (!source.count) items.push(item(key, STATES.ATTENTION, title, `${title} are not configured. Confirm whether they are not applicable.`, { tab }, { count: 0 }));
    else items.push(item(key, STATES.READY, title, `${source.count} ${title.toLowerCase()} ${source.count === 1 ? 'record' : 'records'} available.`, { tab }, { count: source.count }));
  }

  const classifiedItems = items.map(entry => ({
    ...entry,
    draftCreationRequirement: DRAFT_CREATION_REQUIREMENT_KEYS.has(entry.key),
    blocksDraftCreation: Boolean(
      (DRAFT_CREATION_REQUIREMENT_KEYS.has(entry.key) && entry.state === STATES.BLOCKER) ||
      (entry.key === 'cvr_periods' && entry.state === STATES.BLOCKER) ||
      entry.preventsPeriodCreation
    ),
  }));
  const canCreateFirstCvr = !classifiedItems.some(entry => entry.blocksDraftCreation);
  const commercialItems = classifiedItems.filter(entry => !entry.workflowState);
  const overallState = commercialItems.some(entry => entry.state === STATES.BLOCKER)
    ? STATES.BLOCKER
    : commercialItems.some(entry => entry.state === STATES.ATTENTION)
      ? STATES.ATTENTION
      : STATES.READY;
  return { policy: 'gp5b_development_commercial_readiness_v1', overallState, canCreateFirstCvr, hasCvrHistory: Boolean(periods?.rows?.length), establishedLegacy, items: classifiedItems };
}

async function loadDevelopmentCommercialReadiness(clientId, developmentId, query = db.query) {
  const run = async loader => { try { return { available: true, ...(await loader()) }; } catch (error) { return { available: false, error: error.message }; } };
  const developmentResult = await query('SELECT id,job_number,payload FROM developments WHERE client_id=$1 AND id=$2', [clientId, developmentId]);
  const development = developmentResult.rows[0];
  if (!development) return { ok: false, status: 404, message: 'Development not found.' };

  const costCodes = await run(async () => ({ activeCount: Number((await query('SELECT COUNT(*)::int count FROM cost_codes WHERE client_id=$1 AND is_active=true', [clientId])).rows[0].count) }));
  const periods = await run(async () => ({ rows: (await query('SELECT period_key,status,budget_source FROM cvr_periods WHERE client_id=$1 AND development_id=$2 ORDER BY created_at', [clientId, developmentId])).rows.map(row => ({ periodKey: row.period_key, status: row.status, budgetSource: row.budget_source })) }));
  const budget = await run(async () => {
    const rows = (await query('SELECT event_type,source_snapshot,source_snapshot_sha256,source_snapshot_hash_scheme FROM development_budget_events WHERE client_id=$1 AND development_id=$2 ORDER BY sequence_number', [clientId, developmentId])).rows;
    return { exists: rows.some(row => row.event_type === 'opening_budget'), integrityValid: rows.length > 0 && rows.every(row => verifyJsonIntegrity(row.source_snapshot, row.source_snapshot_sha256, row.source_snapshot_hash_scheme).valid) };
  });
  const count = (sql, params = [clientId, developmentId]) => run(async () => ({ count: Number((await query(sql, params)).rows[0].count) }));
  const purchaseOrders = await count(`SELECT COUNT(*)::int count FROM purchase_orders WHERE client_id=$1 AND (payload->>'developmentId'=$2 OR payload->>'jobNumber'=$3)`, [clientId, developmentId, development.job_number]);
  const packages = await count('SELECT COUNT(*)::int count FROM packages WHERE client_id=$1 AND development_id=$2');
  const certificates = await count('SELECT COUNT(*)::int count FROM package_payment_certificates WHERE client_id=$1 AND development_id=$2');
  const commercialEvents = await count(`SELECT (SELECT COUNT(*) FROM commercial_events WHERE client_id=$1 AND development_id=$2)::int + (SELECT COUNT(*) FROM variation_orders WHERE client_id=$1 AND development_id=$2)::int count`);
  const ledger = await count('SELECT COUNT(*)::int count FROM ledger_transactions WHERE client_id=$1 AND development_id=$2');
  const prelims = await count('SELECT COUNT(*)::int count FROM development_prelims_items WHERE client_id=$1 AND development_id=$2');
  const sellingCosts = await count('SELECT COUNT(*)::int count FROM development_selling_costs_settings WHERE client_id=$1 AND development_id=$2');
  const revenue = await run(async () => {
    const candidate = await buildCvrRevenueCloseCandidate({ clientId, developmentId });
    const reasonMessages = {
      'revenue-settings-missing': 'Revenue settings have not been configured.',
      'plot-master-missing': 'The Plot Master has not been configured.',
      'plot-master-unavailable': 'The Plot Master could not be loaded.',
    };
    const reasons = (candidate.blockers || []).map(blocker => blocker.message || reasonMessages[blocker.reason] || 'Revenue information requires review.').filter(Boolean);
    return { ready: Boolean(candidate.ready), reason: reasons.join(' ') || null, plotCount: candidate.plots?.length || 0, plotMasterMissing: candidate.blockers?.some(blocker => blocker.source === 'plotMaster'), sparse: false };
  });
  const plotTenure=await run(async()=>{const plots=development.payload?.plotMaster?.plots;if(!Array.isArray(plots)||!plots.length)return {missing:true,total:0,reviewed:0,needsAttention:0};const valid=new Set(['OPEN_MARKET','AFFORDABLE_RENT','SHARED_OWNERSHIP','FIRST_HOMES','ADDITIONALITY','DISCOUNT_MARKET_SALE','OTHER']);const reviewed=plots.filter(plot=>valid.has(String(plot.tenureCode||'').trim().toUpperCase())).length;return {missing:false,total:plots.length,reviewed,needsAttention:plots.length-reviewed};});
  const variationExposure = await run(async () => {
    const live = await buildLiveVariationExposure({ query }, clientId, developmentId);
    return { blockers: live.blockers || [], itemCount: live.document?.items?.length || 0 };
  });

  return { ok: true, status: 200, readiness: evaluateDevelopmentCommercialReadiness({ costCodes, periods, budget, purchaseOrders, packages, certificates, commercialEvents, ledger, prelims, sellingCosts, revenue, plotTenure, variationExposure }) };
}

module.exports = { STATES, evaluateDevelopmentCommercialReadiness, loadDevelopmentCommercialReadiness };
