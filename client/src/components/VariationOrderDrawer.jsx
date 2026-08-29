import { useEffect, useState } from 'react';
import PODrawerShell from './PODrawerShell';
import { formatMoney, formatPoDateTime } from './poDrawerHelpers';
import { approveAndIssueVariationOrder, submitVariationOrder, updateVariationOrder } from '../api/variationOrders';
import { formatVariationOrderReference, variationOrderStatusLabel } from '../variationOrders/variationOrderPresentation';
import { getCompanySettings } from '../admin/companyStore';
import { notifyCommercialChanged } from '../commercial/commercialEvents';

function formFrom(vo) {
  return {
    reference: vo?.reference || '',
    description: vo?.description || '',
    vatTreatment: vo?.vatTreatment || 'inherit',
    retentionTreatment: vo?.retentionTreatment || 'inherit',
    lines: (vo?.lines || []).map((line) => ({ ...line, netValue: String(line.netValue) })),
  };
}

export default function VariationOrderDrawer({ open, variationOrder, onClose, onChanged }) {
  const [vo, setVo] = useState(variationOrder);
  const [form, setForm] = useState(() => formFrom(variationOrder));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [issueComment, setIssueComment] = useState('Formal instruction approved and issued.');

  useEffect(() => { setVo(variationOrder); setForm(formFrom(variationOrder)); setError(''); }, [variationOrder, open]);
  if (!vo) return null;
  const draft = vo.status === 'draft';
  const submitted = vo.status === 'submitted';

  function setLine(index, field, value) {
    setForm((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line) }));
  }

  function apply(next) {
    setVo(next);
    setForm(formFrom(next));
    onChanged?.(next);
    notifyCommercialChanged({ source: 'variation-order', variationOrderId: next.id, packageId: next.packageId, status: next.status });
  }

  async function run(action) {
    setBusy(true); setError('');
    try {
      if (action === 'save') {
        apply(await updateVariationOrder(vo.id, { ...form, version: vo.version, lines: form.lines.map((line) => ({ ...line, netValue: Number(line.netValue) })) }));
      } else if (action === 'submit') {
        const saved = await updateVariationOrder(vo.id, { ...form, version: vo.version, lines: form.lines.map((line) => ({ ...line, netValue: Number(line.netValue) })) });
        apply(await submitVariationOrder(saved.id, saved.version));
      } else {
        apply(await approveAndIssueVariationOrder(vo.id, vo.version, issueComment));
      }
    } catch (err) { setError(err.message || 'Variation Order action failed.'); }
    finally { setBusy(false); }
  }

  const total = form.lines.reduce((sum, line) => sum + (Number(line.netValue) || 0), 0);
  const company = getCompanySettings();
  return (
    <PODrawerShell open={open} onClose={onClose} wide ariaLabel={formatVariationOrderReference(vo)}>
      <div className="po-ce-drawer vo-drawer">
        <header className="po-ce-drawer__header vo-print-header">
          <div><p className="po-ce-drawer__eyebrow">{company.tradingName || company.companyName || 'BuildLite'} · Variation Order / Formal Instruction</p><h2>{formatVariationOrderReference(vo)}</h2><span className="po-status-badge po-status-badge--muted">{variationOrderStatusLabel(vo.status)}</span></div>
          <div className="vo-screen-actions">{vo.status === 'issued' ? <button type="button" className="po-list-btn-secondary" onClick={() => window.print()}>Print / Save PDF</button> : null}<button type="button" className="po-drawer-close" onClick={onClose}>Close</button></div>
        </header>
        {error ? <p className="po-ce-drawer__errors" role="alert">{error}</p> : null}
        <section className="po-ce-drawer__section"><div className="po-ce-drawer__section-body"><dl className="po-ce-drawer__linked-facts">
          <div><dt>Source Purchase Order</dt><dd>{vo.sourcePoNumber}</dd></div><div><dt>Subcontractor</dt><dd>{vo.supplierLabel}</dd></div>
          <div><dt>Development</dt><dd>{vo.developmentName}</dd></div><div><dt>Source CE</dt><dd>{vo.sourceCommercialEvents?.[0]?.eventNumber || '—'}</dd></div>
          <div><dt>Approved</dt><dd>{vo.approvedAt ? `${formatPoDateTime(vo.approvedAt)} · ${vo.approvedBy || '—'}` : '—'}</dd></div>
          <div><dt>Issued</dt><dd>{vo.issuedAt ? `${formatPoDateTime(vo.issuedAt)} · ${vo.issuedBy || '—'}` : '—'}</dd></div>
        </dl></div></section>
        <section className="po-ce-drawer__section"><div className="po-ce-drawer__section-body">
          <label className="po-ce-drawer__field po-ce-drawer__field--wide"><span>Description / scope</span><textarea rows={4} value={form.description} disabled={!draft} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div className="po-table-wrap"><table className="po-data-table vo-lines-table"><colgroup><col className="vo-lines-table__cost" /><col className="vo-lines-table__description" /><col className="vo-lines-table__value" /></colgroup><thead><tr><th>Cost code</th><th>Description</th><th style={{ textAlign: 'right' }}>Signed net value</th></tr></thead><tbody>
            {form.lines.map((line, index) => <tr key={line.id || index}><td><input value={line.costCode} disabled={!draft} onChange={(e) => setLine(index, 'costCode', e.target.value)} /></td><td><input value={line.description} disabled={!draft} onChange={(e) => setLine(index, 'description', e.target.value)} /></td><td><input type="number" step="0.01" value={line.netValue} disabled={!draft} onChange={(e) => setLine(index, 'netValue', e.target.value)} /></td></tr>)}
          </tbody><tfoot><tr><th colSpan="2">Total Variation Order</th><th style={{ textAlign: 'right' }}>£{formatMoney(total)}</th></tr></tfoot></table></div>
          <p>VAT treatment: {form.vatTreatment === 'inherit' ? 'Inherited from the original order' : form.vatTreatment}. Retention and terms: {form.retentionTreatment === 'inherit' ? 'Inherited from the original order' : form.retentionTreatment}.</p>
        </div></section>
        {draft ? <div className="po-ce-drawer__actions vo-screen-actions"><button disabled={busy} className="po-list-btn-secondary" onClick={() => run('save')}>Save Draft</button><button disabled={busy} className="po-btn-primary" onClick={() => run('submit')}>Submit</button></div> : null}
        {submitted ? <section className="po-ce-drawer__workflow vo-screen-actions"><label className="po-ce-drawer__field po-ce-drawer__field--wide"><span>Issue comment</span><textarea rows={2} value={issueComment} onChange={(e) => setIssueComment(e.target.value)} /></label><button disabled={busy} className="po-btn-primary" onClick={() => run('approveIssue')}>Approve &amp; Issue</button></section> : null}
        {vo.audit?.length ? <section className="po-ce-drawer__section"><div className="po-ce-drawer__section-body"><h3>Audit history</h3><ol className="po-ce-drawer__audit-list">{vo.audit.map((entry) => <li key={entry.id}><strong>{entry.action}</strong><span>{formatPoDateTime(entry.createdAt)}</span><span>{entry.actor || '—'}</span>{entry.comment ? <p>{entry.comment}</p> : null}</li>)}</ol></div></section> : null}
        <footer className="vo-formal-footer"><strong>Formal instruction against Purchase Order {vo.sourcePoNumber}</strong><p>This Variation Order does not replace the original Purchase Order.</p></footer>
        {vo.status === 'issued' ? (
          <article className="vo-print-document" aria-label="Subcontractor-facing Variation Order">
            <header className="vo-print-document__header">
              <p className="vo-print-document__company">{company.tradingName || company.companyName || 'BuildLite'}</p>
              <h1>VARIATION ORDER / FORMAL INSTRUCTION</h1>
              <p className="vo-print-document__reference">{formatVariationOrderReference(vo)}</p>
            </header>
            <dl className="vo-print-document__facts">
              <div><dt>Subcontractor</dt><dd>{vo.supplierLabel}</dd></div>
              <div><dt>Development</dt><dd>{vo.developmentName}</dd></div>
              <div><dt>Original Purchase Order</dt><dd>{vo.sourcePoNumber}</dd></div>
              <div><dt>Issue date</dt><dd>{formatPoDateTime(vo.issuedAt)}</dd></div>
              <div><dt>Source Commercial Event</dt><dd>{vo.sourceCommercialEvents?.[0]?.eventNumber || vo.reference || '—'}</dd></div>
            </dl>
            <section className="vo-print-document__instruction">
              <p><strong>You are instructed to carry out the following variation to the above Purchase Order:</strong></p>
              <p>{vo.description}</p>
              <table>
                <thead><tr><th>Cost code</th><th>Description</th><th>Signed net value</th></tr></thead>
                <tbody>{vo.lines.map((line) => <tr key={line.id || line.lineNumber}><td>{line.costCode}</td><td>{line.description}</td><td>£{formatMoney(line.netValue)}</td></tr>)}</tbody>
              </table>
              <p className="vo-print-document__total"><span>Variation Order value</span><strong>£{formatMoney(vo.totalNetValue)}</strong></p>
            </section>
            <section className="vo-print-document__terms">
              <p><strong>VAT:</strong> {vo.vatTreatment === 'inherit' ? 'VAT treatment follows the original Purchase Order.' : vo.vatTreatment}</p>
              <p>Retention, terms and conditions of the original Purchase Order continue to apply unless expressly varied by this instruction.</p>
            </section>
            <footer className="vo-print-document__authorisation">
              <p><strong>Authorised and issued by:</strong> {vo.issuedBy || '—'}</p>
              <p><strong>Issued:</strong> {formatPoDateTime(vo.issuedAt)}</p>
              <p>This Variation Order amends and does not replace the original Purchase Order.</p>
            </footer>
          </article>
        ) : null}
      </div>
    </PODrawerShell>
  );
}
