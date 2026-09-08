import { useEffect, useMemo, useRef, useState } from 'react';
import { getPaymentReleaseQueue, releasePayments } from '../api/paymentReleases';
import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';

const gbp = value => Number(value || 0).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
const dateOnly = value => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)) : 'Unavailable';
const key = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const FILTERS = [['ready', 'Ready for Accounts'], ['needs_review', 'Needs Review'], ['released', 'In Accounts'], ['all', 'All']];

export default function PaymentReleaseWorklist() {
  const canExecute = useBuildLitePermission('payment_release.execute');
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState('ready');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const confirmRef = useRef(null);
  const load = () => getPaymentReleaseQueue().then(setItems);
  useEffect(() => { if (canExecute) load().catch(error => setFeedback(error.message)); }, [canExecute]);
  useEffect(() => { if (confirming) confirmRef.current?.focus(); }, [confirming]);
  const counts = useMemo(() => items.reduce((value, item) => ({ ...value, [item.workflowState]: (value[item.workflowState] || 0) + 1 }), { ready: 0, needs_review: 0, released: 0 }), [items]);
  const visible = useMemo(() => filter === 'all' ? items : items.filter(item => item.workflowState === filter), [items, filter]);
  const chosen = items.filter(item => selected.includes(item.id));
  const total = chosen.reduce((sum, item) => sum + Number(item.releasableCash || 0), 0);

  const release = async () => {
    setBusy(true);
    setFeedback('Accepting authorised payments into Accounts…');
    try {
      const result = await releasePayments({
        idempotencyKey: key(), reason: 'Accounts handoff accepted', paymentAuthorityDecisionIds: selected,
      });
      setFeedback(`${result.itemCount} authorised payment${result.itemCount === 1 ? '' : 's'} accepted into Accounts: ${gbp(result.totalReleased)}. Not exported, posted or paid.`);
      setSelected([]);
      setConfirming(false);
      await load();
    } catch (error) {
      setFeedback(error.message);
    } finally { setBusy(false); }
  };

  if (!canExecute) return <section className="po-module-card"><h1>Accounts payments</h1><p>You do not have permission to accept authorised payments into Accounts.</p></section>;

  return <section className="po-module-card payment-release-worklist">
    <header><p className="batch-approval-shell__eyebrow">Accounts handoff</p><h1>Accounts payments</h1><p>These payment instructions have already received commercial approval. Accepting them records entry into the Accounts process only; it does not mean exported, posted or paid.</p></header>
    {feedback ? <div role="status" className="po-list-feedback">{feedback}</div> : null}
    <nav aria-label="Accounts payments worklist filters" className="po-ce-drawer__actions">
      {FILTERS.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setSelected([]); }}>{label} ({value === 'all' ? items.length : counts[value]})</button>)}
    </nav>
    <div className="po-table-scroll"><table className="po-data-table">
      <thead><tr><th>Select</th><th>Development</th><th>Supplier</th><th>Certificate</th><th>Authorised amount</th><th>Final payment date</th><th>Accounts status</th></tr></thead>
      <tbody>{visible.map(item => <tr key={item.id}>
        <td><input type="checkbox" aria-label={`Select Payment Authority for Certificate ${item.certificateNumber}`} disabled={!item.eligible} checked={selected.includes(item.id)} onChange={() => setSelected(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}/></td>
        <td><strong>{item.development}</strong></td>
        <td>{item.supplier}</td>
        <td>Certificate {item.certificateNumber}</td>
        <td><strong>{gbp(item.authorisedCash)}</strong></td>
        <td>{dateOnly(item.finalPaymentDate)}</td>
        <td><span className={`po-status-badge po-status-badge--${item.workflowState === 'ready' ? 'approved' : 'pending'}`}>{item.workflowState === 'ready' ? 'Ready for Accounts' : item.workflowState === 'released' ? 'In Accounts' : 'Needs Review'}</span>
          {item.reasons?.map(reason => <small key={reason}>{reason}</small>)}
          {item.warnings?.map(warning => <small key={warning}>{warning}</small>)}
          {item.workflowState === 'released' ? <small>Not exported</small> : null}</td>
      </tr>)}</tbody>
    </table></div>
    {!visible.length ? <p>No payments in this view.</p> : null}
    <div className="po-ce-drawer__actions"><button type="button" disabled={!selected.length || busy} onClick={() => setConfirming(true)}>Accept into Accounts ({selected.length})</button><small>{counts.ready} ready for Accounts · {counts.needs_review} needs review · {counts.released} in Accounts</small></div>
    {confirming ? <div className="po-cert-delete-backdrop" role="presentation"><div className="po-cert-delete modal" role="dialog" aria-modal="true" aria-labelledby="payment-release-title" tabIndex="-1" ref={confirmRef}>
      <h3 id="payment-release-title">Accept selected authorised payments into Accounts?</h3>
      <p>{chosen.length} payment{chosen.length === 1 ? '' : 's'} · {gbp(total)}</p>
      <p>This records that the selected authorised payment instruction{chosen.length === 1 ? ' has' : 's have'} been accepted into the Accounts process. It does not mean {chosen.length === 1 ? 'it has' : 'they have'} been exported, posted or paid.</p>
      <div className="po-cert-delete__actions modal-actions"><button type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button><button type="button" disabled={busy} onClick={release}>{busy ? 'Accepting…' : 'Accept into Accounts'}</button></div>
    </div></div> : null}
  </section>;
}
