// Document presentation only: all valuation facts come from locked certificates.
const { verifyJsonIntegrity } = require('./canonicalJsonIntegrity');
const { calculateCertificateCellValues } = require('./paymentCertificateCalculations');
const UNAVAILABLE = 'Detailed valuation schedule unavailable: incomplete historical frozen evidence.';
const fail = (message, incomplete=false) => { const error=new Error(`Frozen valuation detail unavailable: ${message}`); error.incomplete=incomplete; throw error; };
const missing = message => fail(message,true);
// Presentation only: Intl currency formatting otherwise preserves signed zero.
const presentationMoney = value => value === 0 ? 0 : value;
function pence(value, field) {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) missing(`${field} is missing.`);
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result) || Math.abs(Number(value) * 100 - result) > 0.00001) fail(`${field} is not an exact monetary amount.`);
  return result;
}
const text = (value, field) => typeof value === 'string' && value.trim() ? value : missing(`${field} is missing.`);

function frozenRows(certificate) {
  const payload = certificate.payload || {}, valuation = payload.valuationSnapshot;
  if (!valuation || !Array.isArray(valuation.cells)) missing(`certificate ${certificate.certificate_number} has no valuation snapshot.`);
  const evidence = payload.sourceAuthoritySnapshot?.evidence;
  if (!evidence || !Array.isArray(evidence.variationAssessments) || !Array.isArray(evidence.paymentDiscoveredItems)) missing(`certificate ${certificate.certificate_number} has incomplete frozen source evidence.`);
  if (!Array.isArray(payload.commercialLines)) missing(`certificate ${certificate.certificate_number} has no frozen commercial-line evidence.`);
  const rows = valuation.cells.map(cell => ({
    key: `ordered:${text(cell.plotKey || cell.plotLabel, 'plot')}:${text(cell.stageKey || cell.stageLabel, 'stage')}`,
    reference: cell.plotLabel || cell.plotKey, description: cell.stageLabel || cell.stageKey,
    kind: 'Ordered works', authority: 'Ordered works', contractValue: cell.contractValue == null ? null : pence(cell.contractValue,'contract value')/100, frozenCell: cell,
    previous: pence(cell.previousValue, 'ordered works previous'),
    current: pence(cell.thisCertificateValue, 'ordered works current'),
    cumulative: pence(cell.certifiedToDateValue, 'ordered works cumulative'),
  }));
  if (!rows.length && !(valuation.valuationBasis === 'variation_only' && valuation.variationOnlyConfirmation?.orderedWorks === 0)) {
    missing('empty ordered works require frozen explicit zero-ordered-works confirmation.');
  }
  for (const line of payload.commercialLines || []) {
    if (line.lineType === 'recoveryDeduction') continue; // Already in the payment bridge, outside gross.
    const vo = line.sourceType === 'variationOrder';
    rows.push({key: `${vo ? 'vo' : 'ce'}:${text(vo ? line.variationOrderLineId : line.commercialEventId, 'commercial source identity')}`,
      reference: text(line.sourceReference || line.eventNumber || line.variationOrderReference, 'commercial reference'),
      description: text(line.description, 'commercial description'), kind: 'Commercial valuation',
      authority: vo && evidence?.issuedVoLines?.some(fact => fact.lineId === line.id && fact.authorityStatus === 'issued') ? 'Formal issued VO authority' : 'Commercial authority captured at lock',
      previous: line.sourcePreviouslyCertified == null ? null : pence(line.sourcePreviouslyCertified,'commercial previous'), current: pence(line.amountThisCertificate, 'commercial amount')});
  }
  for (const item of evidence?.variationAssessments || []) {
    rows.push({key: `va:${text(item.variationAccountItemId, 'VA identity')}`, assessmentId: item.id,
      reference: text(item.variationReference, 'VA reference'), description: text(item.description, 'VA description'), kind: 'Variation assessment',
      authority: item.priorAuthority === 0 ? 'VA assessment without prior authority' : 'Prior authority detail captured at lock', classification: item.authorityClassification,
      previous: pence(item.previousCertified, 'VA previous'), current: pence(item.signedAmount, 'VA current'),
      cumulative: pence(item.cumulativeCertified, 'VA cumulative')});
  }
  for (const item of evidence?.paymentDiscoveredItems || []) {
    rows.push({key: `discovered:${text(item.id, 'payment-discovered identity')}`, reference: '',
      description: text(item.description, 'payment-discovered description'), kind: 'Payment-discovered valuation',
      authority: 'No prior commercial authority recorded', current: pence(item.signedAmount, 'payment-discovered amount')});
  }
  const seen = new Set();
  for (const row of rows) { if (seen.has(row.key)) fail(`duplicate valuation source ${row.key}.`); seen.add(row.key); }
  if (rows.reduce((sum, row) => sum + row.current, 0) !== pence(certificate.gross_value, 'frozen gross')) fail(`certificate ${certificate.certificate_number} schedule does not reconcile to frozen gross.`);
  return rows;
}

// Verify a rounding difference from frozen inputs using the existing engine, never a tolerance.
function matrixRounding(row) {
  const delta=row.cumulative-row.previous-row.current;
  const cell=row.frozenCell;
  // Additive historic cells need no rounding bridge. When all frozen inputs
  // exist, verify even additive values so a tampered penny cannot evade checks.
  if (!delta && ['contractValue','previousCumulativePct','thisCertificatePct'].some(name=>cell[name]==null)) return 0;
  for(const name of ['contractValue','previousCumulativePct','thisCertificatePct']) if(cell[name]==null) missing('matrix rounding inputs are incomplete.');
  const expected=calculateCertificateCellValues(cell);
  for(const [field,actual] of [['previousValue',row.previous],['thisCertificateValue',row.current],['certifiedToDateValue',row.cumulative]]) {
    if(pence(expected[field],field)!==actual) fail('matrix figures differ from the frozen engine rounding convention.');
  }
  return delta;
}
function buildValuationSchedule(certificate, priorCertificates = [], decisions = []) {
  // Summary authority is independent of availability of historic line detail.
  const previous = priorCertificates.reduce((sum, item) => sum + pence(item.gross_value, 'previous gross'), 0);
  const current = pence(certificate.gross_value, 'current gross');
  const totals={previousCertified:presentationMoney(previous/100),thisCertificate:presentationMoney(current/100),certifiedToDate:presentationMoney((previous+current)/100)};
  let rows;
  try { rows=frozenRows(certificate); }
  catch(error) { if(!error.incomplete) throw error; return {available:false,message:UNAVAILABLE,rows:[],totals}; }
  const history = new Map();
  let historyComplete=true;
  for (const prior of priorCertificates) {
    let priorRows;
    try {
      priorRows=frozenRows(prior);
      for(const row of priorRows) {
        if(row.kind==='Ordered works') matrixRounding(row);
        // Only a continuous, proven history may contribute a rounding bridge.
        // An unexplained historical opening balance is missing detail, not rounding.
        if(historyComplete && row.previous!=null && row.previous!==(history.get(row.key)?.total||0)) missing('historical opening certification is not supported by earlier frozen detail.');
      }
    }
    catch(error) { if(!error.incomplete) throw error; historyComplete=false; continue; }
    for (const row of priorRows) {
      const entry=history.get(row.key);
      const total=entry?.total||0, cashTotal=(entry?.cashTotal||0)+row.current;
      history.set(row.key, {...row,total:row.kind==='Ordered works'?row.cumulative:total+row.current,cashTotal});
    }
  }
  const currentKeys = new Set(rows.map(row => row.key));
  if(historyComplete) for (const [key, row] of history) if (!currentKeys.has(key)) rows.push({...row, carriedForward:true, assessmentId: null, classification: null,
    authority: 'Previously certified; approval authority detail is retained with the earlier certificate', current: 0, previous: row.total, cumulative: row.total});
  const approved = new Map();
  for (const decision of decisions) {
    if (decision.decision_kind !== 'authority') continue;
    if (!verifyJsonIntegrity(decision.source_snapshot, decision.source_snapshot_sha256, decision.source_snapshot_hash_scheme).valid) fail('Payment Authority approval integrity cannot be verified.');
    if (decision.source_snapshot.certificateId !== certificate.id) fail('Payment Authority certificate identity differs.');
    for (const line of decision.source_snapshot.lines || []) {
      const frozen = decision.decision_lines?.find(item => item.assessment_id === line.assessmentId);
      if (!frozen) fail('Payment Authority decision line is missing.');
      const existing = approved.get(line.assessmentId) || [];
      approved.set(line.assessmentId, [...existing, {...line, newly: pence(frozen.signed_new_commercial_authority, 'Payment Authority granted')}]);
    }
  }
  let currentRounding=0;
  for (const row of rows) {
    const historical=history.get(row.key)?.total || 0;
    const previous = historyComplete ? historical : row.previous;
    if(previous==null) { row.previousCertified=null; row.thisCertificate=row.current/100; row.certifiedToDate=null; continue; }
    if (historyComplete && row.previous != null && row.previous !== previous) fail(`${row.reference} previous certification does not reconcile to locked history.`);
    if (row.kind==='Ordered works' && !row.carriedForward) { try { currentRounding+=matrixRounding(row); } catch(error) { if(error.incomplete) return {available:false,message:UNAVAILABLE,rows:[],totals}; throw error; } }
    else if (row.cumulative != null && row.cumulative !== previous + row.current) fail(`${row.reference} cumulative certification does not reconcile.`);
    row.previousCertified = previous / 100;
    row.thisCertificate = row.current / 100;
    row.certifiedToDate = (row.cumulative ?? (previous + row.current)) / 100;
    if (row.kind === 'Variation assessment') {
      const labels = row.authority === 'VA assessment without prior authority' ? ['VA assessment without prior formal authority at lock'] : [];
      for (const source of row.classification?.supportingSources || []) {
        if (source.sourceType === 'variation_order_line' && source.appliedAmount) labels.push(`Formal issued VO authority: ${text(source.sourceReference, 'VO authority reference')}`);
      }
      if (row.classification?.effectiveCeAuthority) labels.push('CE authority captured at lock');
      if (row.classification?.effectivePaymentAuthority) labels.push('Prior Payment Authority captured at lock');
      for (const approval of approved.get(row.assessmentId) || []) {
        if (approval.newly && approval.exceptionalAuthorityDecision === 'approve' && approval.exceptionalAuthorityReason) labels.push(`Exceptional Payment Authority granted at approval: ${approval.exceptionalAuthorityReason}`);
        for (const support of approval.supports || []) {
          if (support.source?.sourceType === 'variation_order_line') labels.push(`Formal issued VO authority supported at approval: ${text(support.source.reference, 'approval VO reference')}`);
          if (support.source?.sourceType === 'commercial_event') labels.push(`CE authority supported at approval: ${text(support.source.reference, 'approval CE reference')}`);
        }
      }
      row.authority = labels.length ? labels.join('; ') : row.authority;
    }
  }
  if(historyComplete) {
    const previousAdjustment=-[...history.values()].filter(row=>row.kind==='Ordered works').reduce((sum,row)=>sum+row.total-row.cashTotal,0);
    const cumulativeAdjustment=previousAdjustment-currentRounding;
    if(rows.reduce((sum,row)=>sum+pence(row.previousCertified,'schedule previous'),0)+previousAdjustment!==previous) fail('previous schedule total differs from locked gross history.');
    if(rows.reduce((sum,row)=>sum+pence(row.certifiedToDate,'schedule cumulative'),0)+cumulativeAdjustment!==previous+current) fail('cumulative schedule total differs from locked gross history.');
    if(previousAdjustment || cumulativeAdjustment) rows.push({kind:'Matrix rounding reconciliation',reference:'',description:'Independent engine rounding of frozen matrix columns; reconciliation to locked gross summaries only',authority:'Document reconciliation; no change to certified values',previousCertified:previousAdjustment/100,thisCertificate:0,certifiedToDate:cumulativeAdjustment/100});
  }
  return {available:true,rows:rows.filter(row=>row.kind!=='Ordered works'||row.previousCertified!==0||row.thisCertificate!==0||row.certifiedToDate!==0).map(row=>({...row,
    contractValue:presentationMoney(row.contractValue),previousCertified:presentationMoney(row.previousCertified),thisCertificate:presentationMoney(row.thisCertificate),certifiedToDate:presentationMoney(row.certifiedToDate),
    hasContractValue:row.contractValue!=null,hasPrevious:row.previousCertified!=null,hasCumulative:row.certifiedToDate!=null})),
    orderedWorksZero: !(certificate.payload.valuationSnapshot.cells.length),
    zeroOrderedHistoryKnown:historyComplete && ![...history.values()].some(row=>row.kind==='Ordered works'&&row.total!==0), totals, reconciled:true,
    historyIncomplete:!historyComplete, message:historyComplete?null:UNAVAILABLE};
}
module.exports = {buildValuationSchedule};
