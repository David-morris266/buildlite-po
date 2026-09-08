import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';
import {
  addApplicationVariation,
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

function authorityStatus(item, evidence, assessment) {
  const authority = item.authority || {};
  const value = Number(authority.effectiveRecognisedAuthority || 0);
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

export default function PaymentCertificateVariationsWorkspace({ packageId, certificate, editable, onChanged }) {
  const canCreate = useBuildLitePermission('variation_account.create');
  const canAssess = useBuildLitePermission('variation_account.assess');
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
    if (!packageId || !certificate?.id) return;
    const [applications, nextReadiness, nextItems, nextCandidates] = await Promise.all([
      listPaymentApplications(packageId, certificate.id),
      listVariationAssessments(packageId, certificate.id),
      listPackageVariationAccount(packageId),
      listCertificateVariationCandidates(packageId, certificate.id),
    ]);
    const nextApplication = applications.find(entry => entry.status === 'recorded') || null;
    setApplication(nextApplication);
    setLines(nextApplication ? await listApplicationVariations(packageId, nextApplication.id) : []);
    setItems(nextItems);
    setCandidates(nextCandidates.candidates || []);
    setReadiness(nextReadiness.items || []);
    setDrafts(Object.fromEntries((nextReadiness.items || []).map(item => [item.variationAccountItemId, {
      amount: item.assessment?.currentAssessment ?? '', basis: item.assessment?.basis ?? '',
    }])));
  }, [packageId, certificate?.id]);

  useEffect(() => { load().catch(nextError => setError(nextError.message)); }, [load, certificate?.version]);

  const lineByItem = useMemo(() => new Map(lines.filter(line => line.variationAccountItemId).map(line => [line.variationAccountItemId, line])), [lines]);
  const evidenceByItem = useMemo(() => new Map((certificate?.sourceAuthority?.evidence?.variationAssessments || []).map(entry => [entry.variationAccountItemId, entry])), [certificate?.sourceAuthority]);
  const relevant = useMemo(() => readiness.filter(item => item.inCurrentApplication || item.assessment || Number(item.previousCertified) !== 0 || addedIds.includes(item.variationAccountItemId)), [readiness, addedIds]);
  const available = items.filter(item => item.status === 'active' && !relevant.some(row => row.variationAccountItemId === item.id));
  const unresolved = lines.filter(line => !line.variationAccountItemId);
  const approvedCandidates = candidates.filter(candidate => candidate.kind === 'existing_approved');

  const run = async action => {
    setBusy(true); setError('');
    try { await action(); await refreshCertificatesForPackage(packageId); await load(); onChanged?.(); }
    catch (nextError) { setError(nextError.message); }
    finally { setBusy(false); }
  };

  const addVariation = () => {
    const current = Number(capture.currentClaim);
    return run(async () => {
      await addApplicationVariation(packageId, application.id, { ...capture, previousClaim: 0, cumulativeClaim: current, currentClaim: current });
      setCapture(blankVariation); setShowCapture(false);
    });
  };

  const addApprovedClaim = () => {
    const candidate = approvedCandidates.find(entry => entry.id === approvedClaim.candidateId);
    if (!candidate || candidate.reviewRequired) return;
    const current = Number(approvedClaim.currentClaim);
    return run(async () => {
      const line = await addApplicationVariation(packageId, application.id, {
        contractorReference: approvedClaim.contractorReference,
        description: candidate.description,
        contractorValue: approvedClaim.contractorValue,
        previousClaim: 0,
        currentClaim: current,
        cumulativeClaim: current,
      });
      try {
        await reconcileAndAssessCertificateVariation(packageId, certificate.id, application.id, line.id, {
          candidateId: candidate.id,
          currentAssessment: Number(approvedClaim.assessment),
          basis: approvedClaim.basis,
        });
      } catch (nextError) {
        await load();
        throw nextError;
      }
      setApprovedClaim(blankApprovedClaim);
    });
  };

  const totals = relevant.reduce((result, item) => {
    const current = item.assessment ? Number(item.assessment.currentAssessment || 0) : Number(drafts[item.variationAccountItemId]?.amount || 0);
    const evidence = evidenceByItem.get(item.variationAccountItemId);
    result.claim += Number(item.inCurrentApplication ? item.contractorClaim || 0 : 0);
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
      {editable && application && canCreate ? <button type="button" className="po-list-btn-secondary" onClick={() => setShowCapture(open => !open)}>+ Add new / unapproved variation</button> : null}
    </header>
    {!application ? <div className="po-list-feedback" role="status">Record the subcontractor application in Stage 1 before adding application variations.</div> : null}
    {error ? <div role="alert" className="po-list-feedback po-list-feedback--error">{error}</div> : null}
    {editable && application && canCreate && canAssess && !unresolved.length && approvedCandidates.length ? <section className="po-cert-variations-workspace__tasks" aria-label="Existing approved variations">
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
    {showCapture ? <div className="po-cert-variations-workspace__capture">
      <label><span>Contractor reference</span><input className="input" value={capture.contractorReference} onChange={event => setCapture({ ...capture, contractorReference: event.target.value })} /></label>
      <label><span>Description</span><input className="input" value={capture.description} onChange={event => setCapture({ ...capture, description: event.target.value })} /></label>
      <label><span>Contractor value</span><input className="input" type="number" step="0.01" value={capture.contractorValue} onChange={event => setCapture({ ...capture, contractorValue: event.target.value })} /></label>
      <label><span>This application claim</span><input className="input" type="number" step="0.01" value={capture.currentClaim} onChange={event => setCapture({ ...capture, currentClaim: event.target.value })} /></label>
      <div><button type="button" disabled={busy || !capture.description.trim() || capture.contractorValue === '' || capture.currentClaim === ''} onClick={addVariation}>Add variation</button><button type="button" className="po-cert-workspace__link" onClick={() => { setCapture(blankVariation); setShowCapture(false); }}>Cancel</button></div>
    </div> : null}

    {unresolved.length ? <div className="po-cert-variations-workspace__tasks" role="region" aria-label="Variations requiring assessment">
      <h4>Assess application variations</h4>
      {unresolved.map(line => <UnresolvedLine key={line.id} line={line} candidates={candidates} busy={busy} canAssess={canCreate && canAssess} onAssess={payload => run(() => reconcileAndAssessCertificateVariation(packageId, certificate.id, application.id, line.id, payload))} />)}
    </div> : null}

    {editable && canAssess && available.length ? <div className="po-cert-variations-workspace__add-existing"><label><span>Add existing variation</span><select className="input" value={addExistingId} onChange={event => setAddExistingId(event.target.value)}><option value="">Select an active variation</option>{available.map(item => <option key={item.id} value={item.id}>{item.reference} — {item.description}</option>)}</select></label><button type="button" disabled={!addExistingId} onClick={() => { setAddedIds(ids => [...ids, addExistingId]); setAddExistingId(''); }}>Add to assessment</button></div> : null}

    {relevant.length ? <div className="po-table-scroll"><table className="po-data-table po-cert-variations-workspace__table"><thead><tr><th>Variation</th><th>Contractor claim</th><th>Previous</th><th>QS assessment</th><th>To date</th><th>Status / authority</th></tr></thead><tbody>{relevant.map(item => {
      const draft = drafts[item.variationAccountItemId] || {};
      const current = Number(draft.amount || 0);
      const evidence = evidenceByItem.get(item.variationAccountItemId);
      const accountItem = items.find(entry => entry.id === item.variationAccountItemId) || item;
      const directSourceOverlap = hasDirectSourceOverlap(accountItem, certificate?.commercialLines);
      const status = directSourceOverlap ? { label: 'Already included through another certificate route', tone: 'warning' } : authorityStatus(accountItem, evidence, item.assessment);
      const line = lineByItem.get(item.variationAccountItemId);
      return <tr key={item.variationAccountItemId}>
        <td><strong>{item.reference}</strong><br/>{item.description}<small>{item.inCurrentApplication ? 'Claimed this application' : Number(item.previousCertified) ? 'Previously certified' : 'Added existing variation'} · {forecastLabel(accountItem)}</small></td>
        <td>{item.inCurrentApplication ? <><strong>{gbp(line?.currentClaim ?? item.contractorClaim)}</strong><small>Cumulative {gbp(line?.cumulativeClaim ?? item.contractorClaim)}</small></> : '—'}</td>
        <td>{gbp(item.previousCertified)}</td>
        <td>{editable && canAssess ? <div className="po-cert-variations-workspace__assessment"><input aria-label={`${item.reference} QS assessment this certificate`} className="input" type="number" step="0.01" value={draft.amount ?? ''} onChange={event => setDrafts(all => ({ ...all, [item.variationAccountItemId]: { ...draft, amount: event.target.value } }))}/><input aria-label={`${item.reference} assessment basis`} className="input" placeholder="QS assessment basis" value={draft.basis ?? ''} onChange={event => setDrafts(all => ({ ...all, [item.variationAccountItemId]: { ...draft, basis: event.target.value } }))}/><div><button type="button" disabled={busy || directSourceOverlap || !draft.amount || !String(draft.basis || '').trim()} onClick={() => run(() => accountItem.forecastStatus === 'pending' && item.applicationVariationLineId ? reconcileAndAssessCertificateVariation(packageId, certificate.id, application.id, item.applicationVariationLineId, { candidateId: `va:${item.variationAccountItemId}`, currentAssessment: Number(draft.amount), basis: draft.basis }) : saveVariationAssessment(packageId, certificate.id, { variationAccountItemId: item.variationAccountItemId, applicationVariationLineId: item.applicationVariationLineId, currentAssessment: Number(draft.amount), basis: draft.basis }))}>{item.assessment ? 'Update' : 'Apply'} assessment</button>{item.assessment ? <button type="button" className="po-cert-workspace__link po-cert-workspace__link--danger" disabled={busy} onClick={() => run(() => withdrawVariationAssessment(packageId, certificate.id, item.assessment.id))}>Remove</button> : null}</div></div> : gbp(item.assessment?.currentAssessment)}</td>
        <td>{gbp(item.assessment?.cumulativeCertified ?? Number(item.previousCertified || 0) + current)}</td>
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
