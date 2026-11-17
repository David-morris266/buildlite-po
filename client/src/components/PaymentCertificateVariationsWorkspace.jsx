import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';
import {
  addApplicationVariation,
  matchApplicationVariation,
  listApplicationVariations,
  listPackageVariationAccount,
  listPaymentApplications,
} from '../api/paymentApplications';
import {
  listCertificateVariationCandidates,
  listVariationAssessments,
  reconcileAndAssessCertificateVariation,
  saveVariationAssessment,
  withdrawVariationAssessment,
} from '../api/paymentCertificates';
import { refreshCertificatesForPackage } from '../payments/paymentCertificateServerCache';

const gbp = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value) || 0);
const blankVariation = { contractorReference: '', description: '', contractorValue: '', currentClaim: '' };
const blankApprovedClaim = { candidateId: '', contractorReference: '', contractorValue: '', currentClaim: '', assessment: '', basis: '' };

function forecastLabel(item) {
  return item?.forecastStatus === 'pending' || item?.qsForecast == null ? 'Forecast pending' : `QS Forecast ${gbp(item.qsForecast)}`;
}

function authorityStatus(item, evidence, assessment, cumulativeAssessment = 0) {
  const authority = item.authority || {};
  const value = Number(authority.effectiveRecognisedAuthority || 0);
  const cumulative = Number(cumulativeAssessment || 0);
  const exceedsAuthority = value && cumulative && (Math.sign(value) !== Math.sign(cumulative) || Math.abs(cumulative) > Math.abs(value) + 0.005);
  if (exceedsAuthority) return { label: `Assessment to date ${gbp(cumulative)} exceeds current authority ${gbp(value)}`, tone: 'warning' };
  if (Number(authority.effectiveVoAuthority || 0)) return { label: `Current approved authority ${gbp(authority.effectiveVoAuthority)}`, tone: 'recognised' };
  if (Number(authority.effectiveCeAuthority || 0)) return { label: `Current approved authority ${gbp(authority.effectiveCeAuthority)}`, tone: 'recognised' };
  if (Number(authority.effectivePaymentAuthority || 0)) return { label: `Payment Authority recognised ${gbp(authority.effectivePaymentAuthority)}`, tone: 'recognised' };
  if (value) return { label: `Authority recognised ${gbp(value)}`, tone: 'recognised' };
  const unapproved = evidence?.unapprovedAmount ?? (assessment ? Math.abs(Number(assessment.currentAssessment || 0)) : 0);
  if (unapproved) return { label: `No prior authority · ${gbp(unapproved)} unapproved`, tone: 'warning' };
  return { label: 'New / unapproved variation', tone: 'neutral' };
}

function hasDirectSourceOverlap(item, commercialLines = []) {
  const allocations = item?.authority?.allocations || [];
  return commercialLines.some(line => allocations.some(allocation =>
    (line.sourceType === 'variationOrder' && line.variationOrderLineId && line.variationOrderLineId === allocation.variationOrderLineId)
    || (line.sourceType !== 'variationOrder' && line.commercialEventId && line.commercialEventId === allocation.commercialEventId)
  ));
}

export default function PaymentCertificateVariationsWorkspace({ packageId, certificate, editable, onChanged, applicationRefreshKey = 0 }) {
  const canCreate = useBuildLitePermission('variation_account.create');
  const canAssess = useBuildLitePermission('variation_account.assess');
  const scope = `${packageId}:${certificate?.id}:${applicationRefreshKey}`;
  const [loadedScope, setLoadedScope] = useState(null);
  const requestSequence = useRef(0);
  const claimEditable = editable && String(certificate?.status || '').toLowerCase() === 'draft' && loadedScope === scope;
  const [application, setApplication] = useState(null);
  const [lines, setLines] = useState([]);
  const [items, setItems] = useState([]);
  const [readiness, setReadiness] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [addedIds, setAddedIds] = useState([]);
  const [addExistingId, setAddExistingId] = useState('');
  const [showCapture, setShowCapture] = useState(false);
  const [capture, setCapture] = useState(blankVariation);
  const [approvedClaim, setApprovedClaim] = useState(blankApprovedClaim);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoadedScope(null);
    setApplication(null);
    setLines([]);
    setShowCapture(false);
    setCapture(blankVariation);
    setApprovedClaim(blankApprovedClaim);
    if (!packageId || !certificate?.id) return;
    try {
      const [applications, nextReadiness, nextItems, nextCandidates] = await Promise.all([
        listPaymentApplications(packageId, certificate.id),
        listVariationAssessments(packageId, certificate.id),
        listPackageVariationAccount(packageId),
        listCertificateVariationCandidates(packageId, certificate.id),
      ]);
      const nextApplication = applications.find(entry => entry.status === 'recorded') || null;
      const nextLines = nextApplication ? await listApplicationVariations(packageId, nextApplication.id) : [];
      if (request !== requestSequence.current) return;
      setApplication(nextApplication);
      setLines(nextLines);
      setItems(nextItems);
      setCandidates(nextCandidates.candidates || []);
      setReadiness(nextReadiness.items || []);
      setDrafts(Object.fromEntries((nextReadiness.items || []).map(item => [item.variationAccountItemId, {
        amount: item.assessment?.currentAssessment ?? '', basis: item.assessment?.basis ?? '',
      }])));
      setLoadedScope(scope);
    } catch (nextError) {
      if (request === requestSequence.current) throw nextError;
    }
  }, [packageId, certificate?.id, scope]);

  useEffect(() => {
    load().catch(nextError => setError(nextError.message));
    return () => { requestSequence.current += 1; };
  }, [load, certificate?.version]);

  const lineByItem = useMemo(() => new Map(lines.filter(line => line.variationAccountItemId).map(line => [line.variationAccountItemId, line])), [lines]);
  const evidenceByItem = useMemo(() => new Map((certificate?.sourceAuthority?.evidence?.variationAssessments || []).map(entry => [entry.variationAccountItemId, entry])), [certificate?.sourceAuthority]);
  const relevant = useMemo(() => readiness.filter(item => item.inCurrentApplication || item.assessment || Number(item.previousCertified) !== 0 || addedIds.includes(item.variationAccountItemId)), [readiness, addedIds]);
  const available = items.filter(item => item.status === 'active' && !relevant.some(row => row.variationAccountItemId === item.id));
  const unresolved = lines.filter(line => !line.variationAccountItemId);
  const approvedCandidates = candidates.filter(candidate => candidate.kind === 'existing_approved');

  const run = async (action, applicationWrite = false) => {
    setBusy(true); setError('');
    const request = requestSequence.current;
    const assertCurrent = () => {
      if (request !== requestSequence.current) throw new Error('Application revision changed.');
    };
    try {
      if (applicationWrite) {
        if (!claimEditable || !application) return;
        const latest = (await listPaymentApplications(packageId, certificate.id)).find(entry => entry.status === 'recorded');
        assertCurrent();
        if (latest?.id !== application.id) throw new Error('Application revision changed.');
      }
      await action(assertCurrent);
      assertCurrent();
      await refreshCertificatesForPackage(packageId);
      assertCurrent();
      await load(); onChanged?.();
    }
    catch (nextError) {
      if (/application revision changed|frozen|superseded/i.test(nextError.message)) {
        setError('The application has changed or is no longer editable. Refreshing the current revision. No claim request has been replayed; check recorded evidence before trying again.');
        // An old operation must not start a load for its obsolete scope.
        if (request === requestSequence.current) {
          try { await load(); } catch (refreshError) { setError(`The application has changed. Current evidence could not be refreshed: ${refreshError.message}. Do not repeat the claim until it has been checked.`); }
        }
      } else setError(nextError.message);
    }
    finally { setBusy(false); }
  };

  const recordExistingClaim = (item, values, existingLineId) => run(async assertCurrent => {
    if (!claimEditable || !canCreate || !application) return;
    let lineId = existingLineId;
    if (!lineId) {
      const line = await addApplicationVariation(packageId, application.id, {
        contractorReference: item.reference,
        description: item.description,
        contractorValue: Number(values.contractorValue),
        previousClaim: Number(values.previous),
        currentClaim: Number(values.current),
        cumulativeClaim: (Math.round(Number(values.previous) * 100) + Math.round(Number(values.current) * 100)) / 100,
      });
      assertCurrent();
      lineId = line.id;
      // Retain evidence immediately: a failed match must never retry creation.
      setLines(current => [...current, line]);
    }
    try {
      await matchApplicationVariation(packageId, application.id, lineId, item.variationAccountItemId);
      assertCurrent();
      setLines(current => current.map(line => line.id === lineId ? { ...line, variationAccountItemId: item.variationAccountItemId } : line));
    } catch (nextError) {
      throw new Error(`Claim evidence recorded but not matched. Use Match existing claim to retry without creating another claim. ${nextError.message}`);
    }
  }, true);

  const addVariation = () => {
    const current = Number(capture.currentClaim);
    return run(async assertCurrent => {
      await addApplicationVariation(packageId, application.id, { ...capture, previousClaim: 0, cumulativeClaim: current, currentClaim: current });
      assertCurrent();
      setCapture(blankVariation); setShowCapture(false);
    }, true);
  };

  const addApprovedClaim = () => {
    const candidate = approvedCandidates.find(entry => entry.id === approvedClaim.candidateId);
    if (!candidate || candidate.reviewRequired) return;
    const current = Number(approvedClaim.currentClaim);
    return run(async assertCurrent => {
      const line = await addApplicationVariation(packageId, application.id, {
        contractorReference: approvedClaim.contractorReference,
        description: candidate.description,
        contractorValue: approvedClaim.contractorValue,
        previousClaim: 0,
        currentClaim: current,
        cumulativeClaim: current,
      });
      assertCurrent();
      setLines(current => [...current, line]);
      await reconcileAndAssessCertificateVariation(packageId, certificate.id, application.id, line.id, {
        candidateId: candidate.id,
        currentAssessment: Number(approvedClaim.assessment),
        basis: approvedClaim.basis,
      });
      assertCurrent();
      setApprovedClaim(blankApprovedClaim);
    }, true);
  };

  const totals = relevant.reduce((result, item) => {
    const current = item.assessment ? Number(item.assessment.currentAssessment || 0) : Number(drafts[item.variationAccountItemId]?.amount || 0);
    const evidence = evidenceByItem.get(item.variationAccountItemId);
    result.claim += Number(lineByItem.get(item.variationAccountItemId)?.currentClaim ?? 0);
    result.previous += Number(item.previousCertified || 0);
    result.current += current;
    result.toDate += Number(item.previousCertified || 0) + current;
    result.unapproved += Number(evidence?.unapprovedAmount || 0);
    if (current && !evidence) result.unapprovedPending = true;
    return result;
  }, { claim: 0, previous: 0, current: 0, toDate: 0, unapproved: 0, unapprovedPending: false });

  return <section className="po-module-card po-cert-variations-workspace">
    <header className="po-cert-variations-workspace__header">
      <div><p className="po-cert-detail__eyebrow">Stage 3</p><h3>Variations</h3><p>Review contractor claims and record the QS assessment. BuildLite manages the underlying authority trail.</p></div>
      {claimEditable && application && canCreate ? <button type="button" className="po-list-btn-secondary" onClick={() => setShowCapture(open => !open)}>+ Add new / unapproved variation</button> : null}
    </header>
    {loadedScope !== scope ? <div role="status">Refreshing current application revision...</div> : !application ? <div className="po-list-feedback" role="status">Record the subcontractor application in Stage 1 before adding application variations.</div> : null}
    {error ? <div role="alert" className="po-list-feedback po-list-feedback--error">{error}</div> : null}
    {claimEditable && application && canCreate && canAssess && !unresolved.length && approvedCandidates.length ? <section className="po-cert-variations-workspace__tasks" aria-label="Existing approved variations">
      <h4>Existing approved variation</h4>
      <p>Select a known approved variation, record the contractor claim and make this certificate's QS assessment. BuildLite keeps the underlying authority linkage.</p>
      <label><span>Approved variation</span><select aria-label="Existing approved variation" className="input" value={approvedClaim.candidateId} onChange={event => setApprovedClaim({ ...blankApprovedClaim, candidateId: event.target.value })}><option value="">Select approved variation</option>{approvedCandidates.map(candidate => <option key={candidate.id} value={candidate.id} disabled={candidate.reviewRequired}>{candidate.reference} — {candidate.description}{candidate.reviewRequired ? ' — Needs review' : ` — current approved authority ${gbp(candidate.currentAuthority)}`}</option>)}</select></label>
      {approvedCandidates.filter(candidate => candidate.reviewRequired).map(candidate => <p key={candidate.id} className="po-list-feedback po-list-feedback--warning">{candidate.reference}: {candidate.reviewReason}</p>)}
      {approvedClaim.candidateId ? <div className="po-cert-variations-workspace__capture">
        <label><span>Contractor reference</span><input aria-label="Existing variation contractor reference" className="input" value={approvedClaim.contractorReference} onChange={event => setApprovedClaim(current => ({ ...current, contractorReference: event.target.value }))}/></label>
        <label><span>Contractor stated variation value</span><input aria-label="Existing variation contractor value" className="input" type="number" step="0.01" value={approvedClaim.contractorValue} onChange={event => setApprovedClaim(current => ({ ...current, contractorValue: event.target.value }))}/></label>
        <label><span>Contractor claim this application</span><input aria-label="Existing variation contractor claim" className="input" type="number" step="0.01" value={approvedClaim.currentClaim} onChange={event => setApprovedClaim(current => ({ ...current, currentClaim: event.target.value }))}/></label>
        <label><span>QS assessment this certificate</span><input aria-label="Existing variation QS assessment" className="input" type="number" step="0.01" value={approvedClaim.assessment} onChange={event => setApprovedClaim(current => ({ ...current, assessment: event.target.value }))}/></label>
        <label><span>Assessment basis</span><input aria-label="Existing variation assessment basis" className="input" value={approvedClaim.basis} onChange={event => setApprovedClaim(current => ({ ...current, basis: event.target.value }))}/></label>
        <div><button type="button" disabled={busy || !approvedClaim.contractorReference.trim() || approvedClaim.contractorValue === '' || approvedClaim.currentClaim === '' || approvedClaim.assessment === '' || !approvedClaim.basis.trim()} onClick={addApprovedClaim}>Add claim and assessment</button><button type="button" className="po-cert-workspace__link" onClick={() => setApprovedClaim(blankApprovedClaim)}>Cancel</button></div>
      </div> : null}
    </section> : null}
    {showCapture && claimEditable && application ? <div className="po-cert-variations-workspace__capture">
      <label><span>Contractor reference</span><input className="input" value={capture.contractorReference} onChange={event => setCapture({ ...capture, contractorReference: event.target.value })} /></label>
      <label><span>Description</span><input className="input" value={capture.description} onChange={event => setCapture({ ...capture, description: event.target.value })} /></label>
      <label><span>Contractor value</span><input className="input" type="number" step="0.01" value={capture.contractorValue} onChange={event => setCapture({ ...capture, contractorValue: event.target.value })} /></label>
      <label><span>This application claim</span><input className="input" type="number" step="0.01" value={capture.currentClaim} onChange={event => setCapture({ ...capture, currentClaim: event.target.value })} /></label>
      <div><button type="button" disabled={busy || !capture.description.trim() || capture.contractorValue === '' || capture.currentClaim === ''} onClick={addVariation}>Add variation</button><button type="button" className="po-cert-workspace__link" onClick={() => { setCapture(blankVariation); setShowCapture(false); }}>Cancel</button></div>
    </div> : null}

    {unresolved.length ? <div className="po-cert-variations-workspace__tasks" role="region" aria-label="Variations requiring assessment">
      <h4>Assess application variations</h4>
      {unresolved.map(line => <UnresolvedLine key={line.id} line={line} candidates={candidates} busy={busy} canAssess={claimEditable && canCreate && canAssess} onAssess={payload => run(() => reconcileAndAssessCertificateVariation(packageId, certificate.id, application.id, line.id, payload), true)} />)}
    </div> : null}

    {claimEditable && (canAssess || canCreate) && available.length ? <div className="po-cert-variations-workspace__add-existing"><label><span>Add existing variation</span><select className="input" value={addExistingId} onChange={event => setAddExistingId(event.target.value)}><option value="">Select an active variation</option>{available.map(item => <option key={item.id} value={item.id}>{item.reference} — {item.description}</option>)}</select></label><button type="button" disabled={!addExistingId} onClick={() => { setAddedIds(ids => [...ids, addExistingId]); setAddExistingId(''); }}>Add to assessment</button></div> : null}

    {relevant.length ? <div className="po-table-scroll"><table className="po-data-table po-cert-variations-workspace__table"><thead><tr><th>Variation</th><th>Application claim</th><th>Previously certified</th><th>QS assessment this certificate</th><th>Cumulative certified</th><th>Claim less assessment</th><th>Status / authority</th></tr></thead><tbody>{relevant.map(item => {
      const draft = drafts[item.variationAccountItemId] || {};
      const current = Number(draft.amount || 0);
      const evidence = evidenceByItem.get(item.variationAccountItemId);
      const accountItem = items.find(entry => entry.id === item.variationAccountItemId) || item;
      const directSourceOverlap = hasDirectSourceOverlap(accountItem, certificate?.commercialLines);
      const cumulativeAssessment = item.assessment?.cumulativeCertified ?? Number(item.previousCertified || 0) + current;
      const status = directSourceOverlap ? { label: 'Already included through another certificate route', tone: 'warning' } : authorityStatus(accountItem, evidence, item.assessment, cumulativeAssessment);
      const line = lineByItem.get(item.variationAccountItemId);
      const claim = line?.currentClaim;
      const assessed = item.assessment?.currentAssessment;
      return <tr key={item.variationAccountItemId}>
        <td><strong>{item.reference}</strong><br/>{item.description}<small>{item.inCurrentApplication ? 'Claimed this application' : Number(item.previousCertified) ? 'Previously certified' : 'Added existing variation'} · {forecastLabel(accountItem)}</small></td>
        <td><small>Recorded contractor position (reference): {item.contractorValue == null ? 'Not recorded' : gbp(item.contractorValue)}</small>
          {line ? <><strong>Current claim {gbp(claim)}</strong><small>Cumulative application claim {gbp(line.cumulativeClaim)}</small></> : <><span>Application claim not recorded</span>{claimEditable && canCreate && application ? <ExistingVaClaim key={`${packageId}:${certificate.id}:${application.id}:${item.variationAccountItemId}`} item={item} unresolved={unresolved} busy={busy} onRecord={(values, lineId) => recordExistingClaim(item, values, lineId)} /> : null}</>}
        </td>
        <td>{gbp(item.previousCertified)}</td>
        <td>{editable && canAssess ? <div className="po-cert-variations-workspace__assessment"><input aria-label={`${item.reference} QS assessment this certificate`} className="input" type="number" step="0.01" value={draft.amount ?? ''} onChange={event => setDrafts(all => ({ ...all, [item.variationAccountItemId]: { ...draft, amount: event.target.value } }))}/><input aria-label={`${item.reference} assessment basis`} className="input" placeholder="QS assessment basis" value={draft.basis ?? ''} onChange={event => setDrafts(all => ({ ...all, [item.variationAccountItemId]: { ...draft, basis: event.target.value } }))}/><div><button type="button" disabled={busy || directSourceOverlap || !draft.amount || !String(draft.basis || '').trim()} onClick={() => run(() => accountItem.forecastStatus === 'pending' && item.applicationVariationLineId ? reconcileAndAssessCertificateVariation(packageId, certificate.id, application.id, item.applicationVariationLineId, { candidateId: `va:${item.variationAccountItemId}`, currentAssessment: Number(draft.amount), basis: draft.basis }) : saveVariationAssessment(packageId, certificate.id, { variationAccountItemId: item.variationAccountItemId, applicationVariationLineId: item.applicationVariationLineId, currentAssessment: Number(draft.amount), basis: draft.basis }))}>{item.assessment ? 'Update' : 'Apply'} assessment</button>{item.assessment ? <button type="button" className="po-cert-workspace__link po-cert-workspace__link--danger" disabled={busy} onClick={() => run(() => withdrawVariationAssessment(packageId, certificate.id, item.assessment.id))}>Remove</button> : null}</div></div> : gbp(item.assessment?.currentAssessment)}</td>
        <td>{gbp(item.assessment?.cumulativeCertified ?? Number(item.previousCertified || 0) + current)}</td>
        <td>{claim == null || assessed == null ? 'Not available' : gbp((Math.round(Number(claim) * 100) - Math.round(Number(assessed) * 100)) / 100)}</td>
        <td><span className={`po-cert-variations-workspace__status po-cert-variations-workspace__status--${status.tone}`}>{status.label}</span><details><summary>View provenance</summary><dl><div><dt>Contractor value</dt><dd>{item.contractorValue == null ? 'Not recorded' : gbp(item.contractorValue)}</dd></div><div><dt>QS Forecast</dt><dd>{accountItem.forecastStatus === 'pending' || accountItem.qsForecast == null ? 'Pending assessment' : gbp(accountItem.qsForecast)}</dd></div><div><dt>Assessment basis</dt><dd>{draft.basis || 'Not recorded'}</dd></div><div><dt>Effective recognised authority</dt><dd>{gbp(accountItem.authority?.effectiveRecognisedAuthority)}</dd></div></dl></details></td>
      </tr>;
    })}</tbody></table></div> : <p>No current variation claims or assessments.</p>}

    <dl className="po-cert-variations-workspace__totals" aria-label="Variation assessment summary"><div><dt>Contractor claims this period</dt><dd>{gbp(totals.claim)}</dd></div><div><dt>QS assessment this certificate</dt><dd>{gbp(totals.current)}</dd></div><div><dt>Previously certified</dt><dd>{gbp(totals.previous)}</dd></div><div><dt>Certified to date</dt><dd>{gbp(totals.toDate)}</dd></div><div><dt>Unapproved variation assessment</dt><dd>{totals.unapprovedPending ? 'Calculated after save' : gbp(totals.unapproved)}</dd></div></dl>
  </section>;
}

function UnresolvedLine({ line, candidates, busy, canAssess, onAssess }) {
  const [selection, setSelection] = useState('');
  const [assessment, setAssessment] = useState('');
  const [basis, setBasis] = useState('');
  const approved = candidates.filter(candidate => candidate.kind === 'existing_approved');
  return <article className="po-cert-variations-workspace__task">
    <div className="po-cert-variations-workspace__task-summary"><strong>{line.contractorReference || 'New variation'} — {line.description}</strong><span>Contractor claims {gbp(line.currentClaim)} this application · {gbp(line.cumulativeClaim)} cumulative</span></div>
    {canAssess ? <div className="po-cert-variations-workspace__choices"><section className="po-cert-variations-workspace__choice" aria-label="Assess variation">
      <h5>Commercial treatment</h5><label><span>Variation</span><select className="input" value={selection} onChange={event => setSelection(event.target.value)}><option value="">Select treatment</option>{approved.map(candidate => <option key={candidate.id} value={candidate.id} disabled={candidate.reviewRequired}>{candidate.reference} — {candidate.description}{candidate.currentAuthority == null ? ' — Needs review' : ` — current approved authority ${gbp(candidate.currentAuthority)}`}</option>)}<option value="new">New / unapproved variation</option></select></label>
      {selection ? <><label><span>QS assessment this certificate</span><input className="input" type="number" step="0.01" value={assessment} onChange={event => setAssessment(event.target.value)} /></label><label><span>Assessment basis</span><input className="input" value={basis} onChange={event => setBasis(event.target.value)} /></label><button type="button" disabled={busy || assessment === '' || !basis.trim()} onClick={() => onAssess({ candidateId: selection, currentAssessment: Number(assessment), basis })}>Apply assessment</button></> : null}
    </section></div> : <strong className="po-cert-variations-workspace__status--warning">Permission required to assess this variation</strong>}
  </article>;
}

function ExistingVaClaim({ item, unresolved, busy, onRecord }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [previous, setPrevious] = useState('0');
  const [contractorValue, setContractorValue] = useState(item.contractorValue ?? '');
  const [lineId, setLineId] = useState('');
  const valid = [current, previous, contractorValue].every(value => value !== '' && Number.isFinite(Number(value)));
  return <div className="po-cert-variations-workspace__assessment">
    <button type="button" disabled={busy} onClick={() => setOpen(value => !value)}>Record claim this application</button>
    {open ? unresolved.length ? <>
      <p>Unmatched claim evidence exists. Match the appropriate evidence before recording another claim.</p>
      <label>Unmatched claim evidence<select aria-label={`${item.reference} unmatched claim evidence`} className="input" value={lineId} onChange={event => setLineId(event.target.value)}><option value="">Select recorded claim</option>{unresolved.map(line => <option key={line.id} value={line.id}>{line.contractorReference || line.description} | Current {gbp(line.currentClaim)} | Cumulative {gbp(line.cumulativeClaim)}</option>)}</select></label>
      <button type="button" disabled={busy || !lineId} onClick={() => onRecord(null, lineId)}>Match existing claim to {item.reference}</button>
    </> : <>
      {item.contractorValue == null ? <label>Contractor stated variation value<input aria-label={`${item.reference} contractor stated variation value`} className="input" type="number" step="0.01" value={contractorValue} onChange={event => setContractorValue(event.target.value)} /></label> : null}
      <label>Current application claim<input aria-label={`${item.reference} current application claim`} className="input" type="number" step="0.01" value={current} onChange={event => setCurrent(event.target.value)} /></label>
      <label>Previous application claim (contractor evidence, not previous certification)<input aria-label={`${item.reference} previous application claim`} className="input" type="number" step="0.01" value={previous} onChange={event => setPrevious(event.target.value)} /></label>
      <button type="button" disabled={busy || !valid} onClick={() => onRecord({ current, previous, contractorValue })}>Save application claim</button>
    </> : null}
  </div>;
}
