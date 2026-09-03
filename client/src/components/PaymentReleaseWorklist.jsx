import { useEffect, useMemo, useRef, useState } from 'react';
import { getPaymentReleaseQueue, releasePayments } from '../api/paymentReleases';
import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';

const gbp = value => Number(value || 0).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
const dateOnly = value => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)) : 'Unavailable';
const key = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const FILTERS = [['ready', 'Ready to Release'], ['needs_review', 'Needs Review'], ['released', 'Released'], ['all', 'All']];

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
    setFeedback('Releasing authorised payments to Accounts…');
    try {
      const result = await releasePayments({
        idempotencyKey: key(), reason: 'Finance release to Accounts', paymentAuthorityDecisionIds: selected,
      });
      setFeedback(`${result.itemCount} payment${result.itemCount === 1 ? '' : 's'} released to Accounts: ${gbp(result.totalReleased)}. Not paid or exported.`);
      setSelected([]);
      setConfirming(false);
      await load();
    } catch (error) {
      setFeedback(error.message);
    } finally { setBusy(false); }
  };

  if (!canExecute) return <section className="po-module-card"><h1>Payment Release</h1><p>You do not have permission to release payments to Accounts.</p></section>;

  return <section className="po-module-card payment-release-worklist">
    <header><p className="batch-approval-shell__eyebrow">Finance execution</p><h1>Payment Release</h1><p>Release previously authorised cash to Accounts. This does not mean paid, exported or reconciled.</p></header>
    {feedback ? <div role="status" className="po-list-feedback">{feedback}</div> : null}
    <nav aria-label="Payment Release worklist filters" className="po-ce-drawer__actions">
      {FILTERS.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setSelected([]); }}>{label} ({value === 'all' ? items.length : counts[value]})</button>)}
    </nav>
    <div className="po-table-scroll"><table className="po-data-table">
      <thead><tr><th>Select</th><th>Development / supplier</th><th>Certificate</th><th>Payment Authority</th><th>Final payment date</th><th>Authorised cash</th><th>Prior released</th><th>Releasable</th><th>Status</th></tr></thead>
      <tbody>{visible.map(item => <tr key={item.id}>
        <td><input type="checkbox" aria-label={`Select Payment Authority for Certificate ${item.certificateNumber}`} disabled={!item.eligible} checked={selected.includes(item.id)} onChange={() => setSelected(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}/></td>
        <td><strong>{item.development}</strong><br/>{item.supplier}<br/><small>{item.packageTrade} · {item.costCode}</small></td>
        <td>Certificate {item.certificateNumber}<br/><small>{item.noticeMode}</small></td>
        <td>{dateOnly(item.paymentAuthorityDate)}<br/><small>{item.paymentAuthorityActor}</small></td>
        <td>{dateOnly(item.finalPaymentDate)}</td>
        <td><strong>{gbp(item.authorisedCash)}</strong></td>
        <td>{gbp(item.previouslyReleased)}</td>
        <td><strong>{gbp(item.releasableCash)}</strong></td>
        <td><span className={`po-status-badge po-status-badge--${item.workflowState === 'ready' ? 'approved' : 'pending'}`}>{item.workflowState === 'ready' ? 'Ready to Release' : item.workflowState === 'released' ? 'Released to Accounts' : 'Needs Review'}</span>
          {item.reasons?.map(reason => <small key={reason}>{reason}</small>)}
          {item.warnings?.map(warning => <small key={warning}>{warning}</small>)}
          <small>External status: Not exported</small></td>
      </tr>)}</tbody>
    </table></div>
    {!visible.length ? <p>No payments in this view.</p> : null}
    <div className="po-ce-drawer__actions"><button type="button" disabled={!selected.length || busy} onClick={() => setConfirming(true)}>Review Release ({selected.length})</button><small>{counts.ready} ready · {counts.needs_review} needs review · {counts.released} released</small></div>
    {confirming ? <div className="po-cert-delete-backdrop" role="presentation"><div className="po-cert-delete modal" role="dialog" aria-modal="true" aria-labelledby="payment-release-title" tabIndex="-1" ref={confirmRef}>
      <h3 id="payment-release-title">Release selected authorised payments to Accounts?</h3>
      <p>{chosen.length} payment{chosen.length === 1 ? '' : 's'} · {gbp(total)}</p>
      <p>This records release to the Accounts process only. It does not mean the payment has been paid by a bank, exported, posted, cleared or reconciled.</p>
      <div className="po-cert-delete__actions modal-actions"><button type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button><button type="button" disabled={busy} onClick={release}>{busy ? 'Releasing…' : 'Release to Accounts'}</button></div>
    </div></div> : null}
  </section>;
}
