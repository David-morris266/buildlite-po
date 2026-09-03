import { useEffect, useMemo, useState } from 'react';
import { getPaymentApprovalQueue, approvePaymentAuthorityRun } from '../api/paymentAuthority';
import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';

const gbp = value => Number(value || 0).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
const key = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const FILTERS = [
  ['ready', 'Ready'],
  ['needs_review', 'Needs Review'],
  ['authorised', 'Authorised'],
  ['all', 'All'],
];
const stateOf = item => item.workflowState || (item.eligible ? 'ready' : 'needs_review');

export default function PaymentApprovalRun() {
  const canView = useBuildLitePermission('payment_approval_run.view');
  const canApprove = useBuildLitePermission('payment_authority.approve');
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [filter, setFilter] = useState('ready');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  const load = () => getPaymentApprovalQueue().then(rows => {
    setItems(rows);
    setDrafts(Object.fromEntries(rows.map(row => [row.id, {
      cashAmount: row.cashAmountProposed,
      reason: 'Commercial Director payment approval',
      lines: Object.fromEntries(row.lines.map(line => [line.assessmentId, {
        newCommercialAuthority: line.unresolvedAmount ?? line.unapprovedAtLock,
        basis: 'Payment Authority for locked QS assessment',
        allocationId: '',
        supportAmount: '',
      }])),
    }])));
  });

  useEffect(() => { if (canView) load().catch(error => setFeedback(error.message)); }, [canView]);
  const counts = useMemo(() => items.reduce((result, item) => {
    result[stateOf(item)] += 1;
    return result;
  }, { ready: 0, needs_review: 0, authorised: 0 }), [items]);
  const visibleItems = useMemo(() => filter === 'all' ? items : items.filter(item => stateOf(item) === filter), [items, filter]);

  const set = (certificateId, path, value) => setDrafts(current => {
    const copy = structuredClone(current);
    let target = copy[certificateId];
    for (let index = 0; index < path.length - 1; index += 1) target = target[path[index]];
    target[path.at(-1)] = value;
    return copy;
  });

  const approve = async () => {
    setBusy(true);
    setFeedback('Approving selected certificates…');
    try {
      const decisions = selected.map(id => {
        const item = items.find(row => row.id === id);
        const draft = drafts[id];
        return {
          certificateId: id,
          certificateVersion: item.certificateVersion,
          cashAmount: Number(draft.cashAmount),
          reason: draft.reason,
          idempotencyKey: key(),
          lines: item.lines.map(line => {
            const lineDraft = draft.lines[line.assessmentId];
            return {
              assessmentId: line.assessmentId,
              newCommercialAuthority: Number(lineDraft.newCommercialAuthority),
              basis: lineDraft.basis,
              supportUsages: lineDraft.allocationId && Number(lineDraft.supportAmount)
                ? [{ allocationId: lineDraft.allocationId, amount: Number(lineDraft.supportAmount) }]
                : [],
            };
          }),
        };
      });
      const result = await approvePaymentAuthorityRun({ idempotencyKey: key(), decisions });
      const failed = result.results?.filter(row => !row.ok) || [];
      setFeedback(failed.length
        ? `${result.results.length - failed.length} approved; ${failed.length} failed. ${failed.map(row => row.message).join(' ')}`
        : 'Payment Authority approved.');
      setSelected([]);
      await load();
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (!canView) return <section className="po-module-card"><h1>Payment Approval Run</h1><p>You do not have permission to view this work queue.</p></section>;

  return <section className="po-module-card payment-approval-run">
    <header>
      <p className="batch-approval-shell__eyebrow">Commercial Director authority</p>
      <h1>Payment Approval Run</h1>
      <p>Approve the cash payment envelope and any newly recognised gross commercial authority as separate immutable facts.</p>
    </header>
    {feedback ? <div role="status" className="po-list-feedback">{feedback}</div> : null}
    <nav aria-label="Payment Approval worklist filters" className="po-ce-drawer__actions">
      {FILTERS.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setSelected([]); }}>
        {label} ({value === 'all' ? items.length : counts[value]})
      </button>)}
    </nav>
    <div className="po-table-scroll"><table className="po-data-table">
      <thead><tr><th>Select</th><th>Certificate</th><th>Final date</th><th>Gross / Net</th><th>Notice / intended</th><th>Unapproved</th><th>New commercial authority</th><th>Cash authority</th><th>Status</th></tr></thead>
      <tbody>{visibleItems.map(item => {
        const draft = drafts[item.id] || {};
        const workflowState = stateOf(item);
        const authorised = workflowState === 'authorised';
        const fullReason = item.reasons?.join(' ') || '';
        return <tr key={item.id}>
          <td><input aria-label={`Select certificate ${item.certificateNumber}`} type="checkbox" disabled={workflowState !== 'ready' || !item.eligible || !canApprove} checked={selected.includes(item.id)} onChange={() => setSelected(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}/></td>
          <td><strong>{item.development}</strong><br/>{item.subcontractor}<br/>{item.packageTrade} · Certificate {item.certificateNumber}</td>
          <td>{item.finalPaymentDate || 'Unavailable'}</td>
          <td>{gbp(item.gross)} / {gbp(item.net)}<br/><small>Retention {gbp(item.retention)} · VAT {gbp(item.vat)}</small></td>
          <td>{gbp(item.notifiedSum)} / {gbp(item.intendedPayment)}<br/><small>{item.noticeMode || 'Unavailable'} · Pay Less {gbp(item.payLessReduction)}</small></td>
          <td><strong>{gbp(item.unapprovedAtLock)}</strong><br/><small>Prior cash {gbp(item.priorCashAuthority)}</small></td>
          {authorised ? <>
            <td><strong>{gbp(item.authorisedNewCommercialAuthority)}</strong><br/><small>Granted</small></td>
            <td><strong>{gbp(item.authorisedCashAmount)}</strong><br/><small>Granted · Payment Release not created</small></td>
          </> : <>
            <td>{item.lines.map(line => {
              const lineDraft = draft.lines?.[line.assessmentId] || {};
              return <div className="payment-authority-line" key={line.assessmentId}>
                <strong>{line.reference}</strong><small>Locked unapproved {gbp(line.unapprovedAtLock)}</small>
                {line.existingSupportOptions.length ? <>
                  <select aria-label={`${line.reference} existing authority`} value={lineDraft.allocationId || ''} onChange={event => set(item.id, ['lines', line.assessmentId, 'allocationId'], event.target.value)}><option value="">No existing support applied</option>{line.existingSupportOptions.map(source => <option key={source.id} value={source.id}>{source.reference} · {gbp(source.availableAmount)} available</option>)}</select>
                  <input aria-label={`${line.reference} support amount`} type="number" step="0.01" value={lineDraft.supportAmount || ''} onChange={event => set(item.id, ['lines', line.assessmentId, 'supportAmount'], event.target.value)}/>
                </> : null}
                <input aria-label={`${line.reference} new commercial authority`} type="number" step="0.01" value={lineDraft.newCommercialAuthority ?? ''} onChange={event => set(item.id, ['lines', line.assessmentId, 'newCommercialAuthority'], event.target.value)}/>
                <input aria-label={`${line.reference} basis`} value={lineDraft.basis || ''} onChange={event => set(item.id, ['lines', line.assessmentId, 'basis'], event.target.value)}/>
              </div>;
            })}</td>
            <td><label>Cash authority<input aria-label={`Certificate ${item.certificateNumber} cash authority`} type="number" step="0.01" value={draft.cashAmount ?? ''} onChange={event => set(item.id, ['cashAmount'], event.target.value)}/></label></td>
          </>}
          <td title={fullReason}><span className={`po-status-badge po-status-badge--${workflowState === 'ready' ? 'approved' : 'pending'}`}>{workflowState === 'ready' ? 'Ready' : workflowState === 'authorised' ? 'Authorised' : 'Needs Review'}</span><small>{item.statusSummary || (workflowState === 'ready' ? 'Ready' : 'Needs review')}</small></td>
        </tr>;
      })}</tbody>
    </table></div>
    {!visibleItems.length ? <p>No certificates in this view.</p> : null}
    <div className="po-ce-drawer__actions"><button type="button" disabled={busy || !selected.length || !canApprove} onClick={approve}>{busy ? 'Approving…' : `Approve selected (${selected.length})`}</button><small>{counts.ready} ready · {counts.needs_review} needs review · {counts.authorised} authorised · Payment Release not created by this action.</small></div>
  </section>;
}
