import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';
import {
  addApplicationVariation,
  createVariationFromApplication,
  listApplicationVariations,
  listPackageVariationAccount,
  listPaymentApplications,
  matchApplicationVariation,
} from '../api/paymentApplications';
import {
  listVariationAssessments,
  saveVariationAssessment,
  withdrawVariationAssessment,
} from '../api/paymentCertificates';
import { refreshCertificatesForPackage } from '../payments/paymentCertificateServerCache';
import { listCommercialEvents } from '../api/commercialEvents';

const gbp = (value) => new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP',
}).format(Number(value) || 0);
const blankVariation = { contractorReference: '', description: '', contractorValue: '', currentClaim: '' };

function authorityStatus(item, evidence, assessment) {
  const authority = item.authority || {};
  const value = Number(authority.effectiveRecognisedAuthority || 0);
  if (Number(authority.effectiveVoAuthority || 0)) return { label: `Issued VO — ${gbp(authority.effectiveVoAuthority)}`, tone: 'recognised' };
  if (Number(authority.effectiveCeAuthority || 0)) return { label: `Approved CE — ${gbp(authority.effectiveCeAuthority)}`, tone: 'recognised' };
  if (Number(authority.effectivePaymentAuthority || 0)) return { label: `Payment Authority recognised — ${gbp(authority.effectivePaymentAuthority)}`, tone: 'recognised' };
  if (value) return { label: `Authority recognised — ${gbp(value)}`, tone: 'recognised' };
  const unapproved = evidence?.unapprovedAmount ?? (assessment ? Math.abs(Number(assessment.currentAssessment || 0)) : 0);
  if (unapproved) return { label: `No prior authority — ${gbp(unapproved)} unapproved`, tone: 'warning' };
  return { label: 'Known variation', tone: 'neutral' };
}

function hasDirectSourceOverlap(item, commercialLines = []) {
  const allocations = item?.authority?.allocations || [];
  return commercialLines.some((line) => allocations.some((allocation) =>
    (line.sourceType === 'variationOrder' && line.variationOrderLineId && line.variationOrderLineId === allocation.variationOrderLineId)
    || (line.sourceType !== 'variationOrder' && line.commercialEventId && line.commercialEventId === allocation.commercialEventId)
  ));
}

function knownCommercialItems(events = [], variationItems = []) {
  const representedCeIds = new Set(variationItems.flatMap((item) =>
    (item.authority?.allocations || []).map((allocation) => allocation.commercialEventId).filter(Boolean)
  ));
  return events.filter((event) => {
    const status = String(event.status || '').toLowerCase();
    const treatment = String(event.financialTreatment || '').toLowerCase();
    const relationship = String(event.relationshipType || '').toLowerCase();
    const type = String(event.eventType || event.category || '').toLowerCase();
    const relevantStatus = ['draft', 'submitted', 'approved'].includes(status);
    const contractValue = treatment === 'contractamendment' || type === 'variation';
    const recovery = relationship === 'recovery' || treatment === 'recoverablededuction' || type === 'contracharge';
    return relevantStatus && contractValue && !recovery && !representedCeIds.has(event.id);
  });
}

export default function PaymentCertificateVariationsWorkspace({ packageId, certificate, editable, onChanged }) {
  const canCreate = useBuildLitePermission('variation_account.create');
  const canAssess = useBuildLitePermission('variation_account.assess');
  const [application, setApplication] = useState(null);
  const [lines, setLines] = useState([]);
  const [items, setItems] = useState([]);
  const [readiness, setReadiness] = useState([]);
  const [commercialEvents, setCommercialEvents] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [addedIds, setAddedIds] = useState([]);
  const [addExistingId, setAddExistingId] = useState('');
  const [showCapture, setShowCapture] = useState(false);
  const [capture, setCapture] = useState(blankVariation);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!packageId || !certificate?.id) return;
    const [applications, nextReadiness, nextItems, nextEvents] = await Promise.all([
      listPaymentApplications(packageId, certificate.id),
      listVariationAssessments(packageId, certificate.id),
      listPackageVariationAccount(packageId),
      listCommercialEvents({ packageId }),
    ]);
    const nextApplication = applications.find((entry) => entry.status === 'recorded') || null;
    const nextLines = nextApplication ? await listApplicationVariations(packageId, nextApplication.id) : [];
    setApplication(nextApplication);
    setLines(nextLines);
    setItems(nextItems);
    setCommercialEvents(nextEvents);
    setReadiness(nextReadiness.items || []);
    setDrafts(Object.fromEntries((nextReadiness.items || []).map((item) => [item.variationAccountItemId, {
      amount: item.assessment?.currentAssessment ?? '', basis: item.assessment?.basis ?? '',
    }])));
  }, [packageId, certificate?.id]);

  useEffect(() => { load().catch((nextError) => setError(nextError.message)); }, [load, certificate?.version]);

  const lineByItem = useMemo(() => new Map(lines.filter((line) => line.variationAccountItemId).map((line) => [line.variationAccountItemId, line])), [lines]);
  const evidenceByItem = useMemo(() => new Map((certificate?.sourceAuthority?.evidence?.variationAssessments || []).map((entry) => [entry.variationAccountItemId, entry])), [certificate?.sourceAuthority]);
  const relevant = useMemo(() => readiness.filter((item) => item.inCurrentApplication || item.assessment || Number(item.previousCertified) !== 0 || addedIds.includes(item.variationAccountItemId)), [readiness, addedIds]);
  const available = items.filter((item) => item.status === 'active' && !relevant.some((row) => row.variationAccountItemId === item.id));
  const unresolved = lines.filter((line) => !line.variationAccountItemId);
  const knownItems = useMemo(() => knownCommercialItems(commercialEvents, items), [commercialEvents, items]);

  const run = async (action) => {
    setBusy(true); setError('');
    try { await action(); await refreshCertificatesForPackage(packageId); await load(); onChanged?.(); }
    catch (nextError) { setError(nextError.message); }
    finally { setBusy(false); }
  };

  const addVariation = () => {
    const current = Number(capture.currentClaim);
    return run(async () => {
      await addApplicationVariation(packageId, application.id, {
        ...capture, previousClaim: 0, cumulativeClaim: current, currentClaim: current,
      });
      setCapture(blankVariation); setShowCapture(false);
    });
  };

  const totals = relevant.reduce((result, item) => {
    const draftAmount = Number(drafts[item.variationAccountItemId]?.amount || 0);
    const assessment = item.assessment;
    const current = assessment ? Number(assessment.currentAssessment || 0) : draftAmount;
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
      <div><p className="po-cert-detail__eyebrow">Stage 3</p><h3>Variations</h3><p>Review what the contractor is claiming and record the QS assessment for this certificate.</p></div>
      {editable && application && canCreate ? <button type="button" className="po-list-btn-secondary" onClick={() => setShowCapture((open) => !open)}>+ Add contractor variation</button> : null}
    </header>
    {!application ? <div className="po-list-feedback" role="status">Record the subcontractor application in Stage 1 before adding application variations.</div> : null}
    {error ? <div role="alert" className="po-list-feedback po-list-feedback--error">{error}</div> : null}
    {showCapture ? <div className="po-cert-variations-workspace__capture">
      <label><span>Contractor reference</span><input className="input" value={capture.contractorReference} onChange={(event) => setCapture({ ...capture, contractorReference: event.target.value })} /></label>
      <label><span>Description</span><input className="input" value={capture.description} onChange={(event) => setCapture({ ...capture, description: event.target.value })} /></label>
      <label><span>Contractor value</span><input className="input" type="number" step="0.01" value={capture.contractorValue} onChange={(event) => setCapture({ ...capture, contractorValue: event.target.value })} /></label>
      <label><span>This application claim</span><input className="input" type="number" step="0.01" value={capture.currentClaim} onChange={(event) => setCapture({ ...capture, currentClaim: event.target.value })} /></label>
      <div><button type="button" disabled={busy || !capture.description.trim() || capture.contractorValue === '' || capture.currentClaim === ''} onClick={addVariation}>Add variation</button><button type="button" className="po-cert-workspace__link" onClick={() => { setCapture(blankVariation); setShowCapture(false); }}>Cancel</button></div>
      <p>For an existing contractor claim history, record the full evidence through the application variation history workflow rather than treating it as a first claim.</p>
    </div> : null}

    {unresolved.length ? <div className="po-cert-variations-workspace__tasks" role="region" aria-label="Variations requiring reconciliation">
      <h4>Match new application variations</h4>
      {unresolved.map((line) => <UnresolvedLine key={line.id} line={line} items={items.filter((item) => item.status === 'active')} knownItems={knownItems} busy={busy} canCreate={canCreate} onMatch={(itemId) => run(() => matchApplicationVariation(packageId, application.id, line.id, itemId))} onCreate={(payload) => run(() => createVariationFromApplication(packageId, application.id, line.id, payload))} />)}
    </div> : null}

    {knownItems.length ? <KnownCommercialItems items={knownItems} /> : null}

    {editable && canAssess && available.length ? <div className="po-cert-variations-workspace__add-existing"><label><span>Add existing variation</span><select className="input" value={addExistingId} onChange={(event) => setAddExistingId(event.target.value)}><option value="">Select an active variation</option>{available.map((item) => <option key={item.id} value={item.id}>{item.reference} — {item.description}</option>)}</select></label><button type="button" disabled={!addExistingId} onClick={() => { setAddedIds((ids) => [...ids, addExistingId]); setAddExistingId(''); }}>Add to assessment</button></div> : null}

    {relevant.length ? <div className="po-table-scroll"><table className="po-data-table po-cert-variations-workspace__table"><thead><tr><th>Variation</th><th>Contractor claim</th><th>Previous</th><th>QS assessment</th><th>To date</th><th>Status / authority</th></tr></thead><tbody>{relevant.map((item) => {
      const draft = drafts[item.variationAccountItemId] || {};
      const current = Number(draft.amount || 0);
      const cumulative = Number(item.previousCertified || 0) + current;
      const evidence = evidenceByItem.get(item.variationAccountItemId);
      const accountItem = items.find((entry) => entry.id === item.variationAccountItemId) || item;
      const directSourceOverlap = hasDirectSourceOverlap(accountItem, certificate?.commercialLines);
      const status = directSourceOverlap
        ? { label: 'Already included as a direct authorised variation — remove the duplicate route before assessing', tone: 'warning' }
        : authorityStatus(accountItem, evidence, item.assessment);
      const line = lineByItem.get(item.variationAccountItemId);
      return <tr key={item.variationAccountItemId}>
        <td><strong>{item.reference}</strong><br/>{item.description}<small>{item.inCurrentApplication ? 'Claimed this application' : Number(item.previousCertified) ? 'Previously certified' : 'Added existing variation'} · QS Forecast {gbp(item.qsForecast)}</small></td>
        <td>{item.inCurrentApplication ? <><strong>{gbp(line?.currentClaim ?? item.contractorClaim)}</strong><small>Cumulative {gbp(line?.cumulativeClaim ?? item.contractorClaim)}</small></> : '—'}</td>
        <td>{gbp(item.previousCertified)}</td>
        <td>{editable && canAssess ? <div className="po-cert-variations-workspace__assessment"><input aria-label={`${item.reference} QS assessment this certificate`} className="input" type="number" step="0.01" value={draft.amount ?? ''} onChange={(event) => setDrafts((all) => ({ ...all, [item.variationAccountItemId]: { ...draft, amount: event.target.value } }))}/><input aria-label={`${item.reference} assessment basis`} className="input" placeholder="QS assessment basis" value={draft.basis ?? ''} onChange={(event) => setDrafts((all) => ({ ...all, [item.variationAccountItemId]: { ...draft, basis: event.target.value } }))}/><div><button type="button" disabled={busy || directSourceOverlap || !draft.amount || !String(draft.basis || '').trim()} onClick={() => run(() => saveVariationAssessment(packageId, certificate.id, { variationAccountItemId: item.variationAccountItemId, applicationVariationLineId: item.applicationVariationLineId, currentAssessment: Number(draft.amount), basis: draft.basis }))}>{item.assessment ? 'Update' : 'Apply'} assessment</button>{item.assessment ? <button type="button" className="po-cert-workspace__link po-cert-workspace__link--danger" disabled={busy} onClick={() => run(() => withdrawVariationAssessment(packageId, certificate.id, item.assessment.id))}>Remove</button> : null}</div></div> : gbp(item.assessment?.currentAssessment)}</td>
        <td>{gbp(item.assessment?.cumulativeCertified ?? cumulative)}</td>
        <td><span className={`po-cert-variations-workspace__status po-cert-variations-workspace__status--${status.tone}`}>{status.label}</span><details><summary>View details</summary><dl><div><dt>Contractor value</dt><dd>{item.contractorValue == null ? 'Not recorded' : gbp(item.contractorValue)}</dd></div><div><dt>QS Forecast</dt><dd>{gbp(item.qsForecast)}</dd></div><div><dt>Assessment basis</dt><dd>{draft.basis || 'Not recorded'}</dd></div><div><dt>Effective recognised authority</dt><dd>{gbp(accountItem.authority?.effectiveRecognisedAuthority)}</dd></div></dl></details></td>
      </tr>;
    })}</tbody></table></div> : <p>No current variation claims or assessments. Add an application variation or select an existing variation when one requires assessment.</p>}

    <dl className="po-cert-variations-workspace__totals" aria-label="Variation assessment summary"><div><dt>Contractor claims this period</dt><dd>{gbp(totals.claim)}</dd></div><div><dt>QS assessment this certificate</dt><dd>{gbp(totals.current)}</dd></div><div><dt>Previously certified</dt><dd>{gbp(totals.previous)}</dd></div><div><dt>Certified to date</dt><dd>{gbp(totals.toDate)}</dd></div><div><dt>Unapproved variation assessment</dt><dd>{totals.unapprovedPending ? 'Calculated after save' : gbp(totals.unapproved)}</dd></div></dl>
  </section>;
}

function UnresolvedLine({ line, items, knownItems, busy, canCreate, onMatch, onCreate }) {
  const [selection, setSelection] = useState('');
  const [forecast, setForecast] = useState('');
  const [reason, setReason] = useState('');
  return <article className="po-cert-variations-workspace__task">
    <div className="po-cert-variations-workspace__task-summary"><strong>{line.contractorReference || 'New variation'} — {line.description}</strong><span>Contractor claims {gbp(line.currentClaim)} this application · {gbp(line.cumulativeClaim)} cumulative</span>{knownItems.length ? <span className="po-cert-variations-workspace__known-prompt">Known commercial items exist on this package — review them before creating a new variation.</span> : null}</div>
    {canCreate ? <div className="po-cert-variations-workspace__choices">
      {items.length ? <section className="po-cert-variations-workspace__choice" aria-label="Use existing variation"><h5>Use existing variation</h5><label><span>Select existing variation</span><select className="input" value={selection} onChange={(event) => setSelection(event.target.value)}><option value="">Select variation</option>{items.map((item) => <option key={item.id} value={item.id}>{item.reference} — {item.description}</option>)}</select></label><button type="button" disabled={busy || !selection} onClick={() => onMatch(selection)}>Use existing</button></section> : <p className="po-cert-variations-workspace__no-match">No existing Variation Account item is available to use.</p>}
      {items.length ? <span className="po-cert-variations-workspace__or">OR</span> : null}
      <section className="po-cert-variations-workspace__choice" aria-label="Create new variation"><h5>Create new variation</h5><label><span>QS Forecast</span><input className="input" type="number" step="0.01" value={forecast} onChange={(event) => setForecast(event.target.value)} /></label><label><span>Reason</span><input className="input" value={reason} onChange={(event) => setReason(event.target.value)} /></label><button type="button" disabled={busy || forecast === '' || !reason.trim()} onClick={() => onCreate({ qsForecast: Number(forecast), reason })}>Create new variation</button></section>
    </div> : <strong className="po-cert-variations-workspace__status--warning">Not yet matched</strong>}
  </article>;
}

function KnownCommercialItems({ items }) {
  return <aside className="po-cert-variations-workspace__known" aria-label="Known commercial items">
    <div><h4>Known commercial items</h4><p>BuildLite already knows about these package items. They are context only and are not included in this certificate assessment.</p></div>
    <ul>{items.map((event) => {
      const status = String(event.status || '').toLowerCase();
      const expected = Number(event.effectiveExpectedLiability ?? event.expectedLiability ?? 0);
      return <li key={event.id}><strong>{event.eventNumber || event.reference || event.id} · {event.description}</strong><span>{status === 'submitted' ? 'Submitted CE' : status === 'approved' ? 'Approved CE' : 'Draft CE'} · {gbp(event.value)}</span>{status === 'submitted' && expected ? <span>Included in CVR expected liability: {gbp(expected)}</span> : null}<span>{status === 'approved' ? 'Approved commercial authority; not included for payment here.' : 'Not approved certificate authority.'}</span></li>;
    })}</ul>
  </aside>;
}
