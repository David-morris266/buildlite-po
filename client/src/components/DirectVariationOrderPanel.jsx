import { useEffect, useState } from 'react';
import { useBuildLitePermission } from '../auth/BuildLiteAuthProvider';
import { createDirectVariationOrder, listDirectVariationOrderOverlaps } from '../api/variationOrders';
import { listVariationAccount } from '../api/variationAccounts';
import VariationOrderDrawer from './VariationOrderDrawer';

export default function DirectVariationOrderPanel({ order, packageId }) {
  const allowed = useBuildLitePermission('vo.create');
  const [form, setForm] = useState(null);
  const [variationOrder, setVariationOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [overlaps, setOverlaps] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([listVariationAccount(packageId), listDirectVariationOrderOverlaps(packageId)])
      .then(([value, overlapResult]) => { if (active) { setItems(value || []); setOverlaps(overlapResult?.records || []); } })
      .catch(() => { if (active) { setItems([]); setOverlaps([]); } });
    return () => { active = false; };
  }, [packageId]);

  if (!allowed || !order || !packageId) return null;

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const created = await createDirectVariationOrder({
        developmentId: order.developmentId,
        packageId,
        sourcePoNumber: order.poNumbers?.[0] || order.poNumber,
        supplierId: order.supplierId,
        description: form.description,
        lines: [{ costCode: order.costCode, description: form.description, netValue: Number(form.amount) }],
        directInstruction: {
          treatment: form.treatment,
          reason: form.reason,
          variationAccountItemId: form.treatment === 'link_variation_account' ? form.itemId : null,
          reviewedEvidence: overlaps.map(({ type, id }) => ({ type, id })),
        },
      });
      setVariationOrder(created);
      setForm(null);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  const invalid = !form?.description || !form?.amount || (overlaps.length > 0 && !form?.reason) ||
    (form?.treatment === 'link_variation_account' && !form?.itemId);

  return (
    <section className="po-module-card">
      <h3>Variation Orders</h3>
      {error ? <div role="alert" className="po-list-feedback po-list-feedback--error">{error}</div> : null}
      {form ? (
        <div className="po-cert-application__form">
          <label><span>Description</span><input className="input" value={form.description} onChange={(event) => update('description', event.target.value)} /></label>
          <label><span>Signed net value</span><input className="input" type="number" step="0.01" value={form.amount} onChange={(event) => update('amount', event.target.value)} /></label>
          <label>
            <span>Existing evidence treatment</span>
            <select className="input" value={form.treatment} onChange={(event) => update('treatment', event.target.value)}>
              <option value="independent">Independent instructed work</option>
              <option value="link_variation_account">Reconciles an existing Variation Account item</option>
            </select>
          </label>
          {form.treatment === 'link_variation_account' ? (
            <label>
              <span>Variation Account item</span>
              <select className="input" value={form.itemId} onChange={(event) => update('itemId', event.target.value)}>
                <option value="">Select item</option>
                {items.map((item) => <option key={item.id} value={item.id}>{item.reference} — {item.description}</option>)}
              </select>
            </label>
          ) : null}
          {overlaps.length ? <div role="note"><strong>Potential overlapping evidence reviewed</strong><ul>{overlaps.map((item) => <li key={`${item.type}:${item.id}`}>{item.reference} — {item.description} ({item.status})</li>)}</ul></div> : null}
          <label><span>{overlaps.length ? 'Audited independent/linkage reason' : 'Commercial note (optional)'}</span><input className="input" value={form.reason} onChange={(event) => update('reason', event.target.value)} /></label>
          <button type="button" disabled={busy || invalid} onClick={create}>Create Draft VO</button>
          <button type="button" disabled={busy} onClick={() => setForm(null)}>Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => setForm({ description: '', amount: '', reason: '', treatment: 'independent', itemId: '' })}>Create Variation Order</button>
      )}
      <VariationOrderDrawer open={Boolean(variationOrder)} variationOrder={variationOrder} onChanged={setVariationOrder} onClose={() => setVariationOrder(null)} />
    </section>
  );
}
