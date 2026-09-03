import { useEffect, useState } from 'react';
import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';
import {
  allocateVariationAuthority,
  listEligibleVariationAuthority,
  listVariationAccount,
  reverseVariationAuthority,
} from '../api/variationAccounts';

const gbp = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0));
const blank = { source: '', amount: '', overlapMode: 'additional', predecessorAllocationId: '', substitutedAmount: '', reason: '' };

export default function PackageVariationAccount({ packageId }) {
  const canAllocate = useBuildLitePermission('variation_account.authority_allocate');
  const [items, setItems] = useState([]);
  const [sources, setSources] = useState({});
  const [forms, setForms] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!packageId) return;
    const next = await listVariationAccount(packageId);
    setItems(next);
    const pairs = await Promise.all(next.map(async item => [item.id, await listEligibleVariationAuthority(item.id)]));
    setSources(Object.fromEntries(pairs));
  };
  useEffect(() => { load().catch(e => setError(e.message)); }, [packageId]);
  const form = id => forms[id] || blank;
  const set = (id, key, value) => setForms(current => ({ ...current, [id]: { ...(current[id] || blank), [key]: value } }));
  const run = async action => { setBusy(true); setError(''); try { await action(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const allocate = item => {
    const f = form(item.id), [sourceType, sourceId] = f.source.split('|');
    return run(() => allocateVariationAuthority(item.id, { sourceType, sourceId, allocatedAmount: Number(f.amount), overlapMode: f.overlapMode, predecessorAllocationId: f.predecessorAllocationId || null, substitutedAmount: f.overlapMode === 'replaces' ? Number(f.substitutedAmount) : null, reason: f.reason }));
  };
  return <section className="po-module-card"><h3 className="po-matrix-section__title">Variation Account authority</h3><p className="po-cert-detail__matrix-lead">Explicitly reconcile approved Commercial Events and Issued Variation Order lines. BuildLite never infers overlap.</p>{error ? <div role="alert" className="po-list-feedback po-list-feedback--error">{error}</div> : null}{items.length ? items.map(item => <AuthorityItem key={item.id} item={item} sources={sources[item.id] || []} form={form(item.id)} set={(key, value) => set(item.id, key, value)} allocate={() => allocate(item)} reverse={allocation => { const reason = window.prompt('Reason for authority reversal'); if (reason) run(() => reverseVariationAuthority(item.id, allocation.id, reason)); }} canAllocate={canAllocate} busy={busy} />) : <p>No Variation Account items on this package.</p>}</section>;
}

function AuthorityItem({ item, sources, form, set, allocate, reverse, canAllocate, busy }) {
  const p = item.authority || {}, allocations = p.allocations || [];
  const blurOnWheel = event => event.currentTarget.blur();
  const selectPredecessor = event => {
    const id = event.target.value, predecessor = allocations.find(allocation => allocation.id === id);
    set('predecessorAllocationId', id);
    set('substitutedAmount', predecessor ? Number(predecessor.effectiveAmount).toFixed(2) : '');
  };
  return <article className="po-cert-detail__readonly-note">
    <h4>{item.reference} — {item.description}</h4>
    <dl className="po-cert-detail__commercial-grid"><div><dt>QS Forecast</dt><dd>{gbp(item.qsForecast)}</dd></div><div><dt>Allocated CE authority</dt><dd>{gbp(p.allocatedCeAuthority)}</dd></div><div><dt>Allocated Issued VO authority</dt><dd>{gbp(p.allocatedVoAuthority)}</dd></div><div><dt>Effective recognised authority</dt><dd>{gbp(p.effectiveRecognisedAuthority)}</dd></div><div><dt>Remaining forecast exposure</dt><dd>{gbp(p.remainingForecastExposure ?? item.qsForecast)}</dd></div></dl>
    {p.exception ? <div role="alert" className="po-list-feedback po-list-feedback--error">{p.exception}</div> : null}
    {allocations.length ? <ul>{allocations.map(a => <li key={a.id}>{a.sourceType === 'commercial_event' ? 'Commercial Event' : 'Issued VO'} {a.sourceReference}: allocated {gbp(a.allocatedAmount)}, effective {gbp(a.effectiveAmount)} {canAllocate && a.allocationKind === 'authority' ? <button type="button" disabled={busy} onClick={() => reverse(a)}>Reverse</button> : null}</li>)}</ul> : <p>No authority linked.</p>}
    {canAllocate ? <div className="po-cert-application__form">
      <label><span>Authority source</span><select className="input" value={form.source} onChange={e => set('source', e.target.value)}><option value="">Select eligible authority</option>{sources.filter(s => Math.abs(s.availableAmount) > .004).map(s => <option key={`${s.sourceType}|${s.sourceId}`} value={`${s.sourceType}|${s.sourceId}`}>{s.sourceType === 'commercial_event' ? 'CE' : 'Issued VO'} {s.reference} — {gbp(s.availableAmount)} available</option>)}</select></label>
      <label><span>Signed allocation</span><input className="input" type="number" step="0.01" value={form.amount} onWheel={blurOnWheel} onChange={e => set('amount', e.target.value)} /></label>
      <label><span>Commercial treatment</span><select className="input" value={form.overlapMode} onChange={e => set('overlapMode', e.target.value)}><option value="additional">Additional authority</option><option value="replaces">Replaces existing authority</option></select></label>
      {form.overlapMode === 'replaces' ? <><label><span>Authority being replaced</span><select className="input" value={form.predecessorAllocationId} onChange={selectPredecessor}><option value="">Select existing allocation</option>{allocations.filter(a => Math.abs(a.effectiveAmount) > .004).map(a => <option key={a.id} value={a.id}>{a.sourceReference} — {gbp(a.effectiveAmount)}</option>)}</select></label><label><span>Amount replaced</span><input className="input" type="number" step="0.01" value={form.substitutedAmount} onWheel={blurOnWheel} onChange={e => set('substitutedAmount', e.target.value)} /></label></> : null}
      <label><span>Reason</span><input className="input" value={form.reason} onChange={e => set('reason', e.target.value)} /></label>
      <button type="button" disabled={busy || !form.source || !form.amount || !form.reason || (form.overlapMode === 'replaces' && (!form.predecessorAllocationId || !form.substitutedAmount))} onClick={allocate}>Link authority</button>
    </div> : null}
  </article>;
}
