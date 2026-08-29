import { useEffect, useMemo, useState } from 'react';
import { listCertificateReadyVariationOrderLines } from '../api/variationOrders';
import { addVariationOrderLineToCertificate } from '../payments/paymentCertificateStore';
import { formatMoney } from './poDrawerHelpers';

function signed(value) {
  const amount = Number(value) || 0;
  return `${amount < 0 ? '-' : ''}£${formatMoney(Math.abs(amount))}`;
}

export default function PaymentCertificateVariationOrders({ packageId, orderKey, order, certificate, editable, onLinesChanged }) {
  const [authority, setAuthority] = useState([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [amounts, setAmounts] = useState({});
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let active = true;
    if (!packageId) return undefined;
    listCertificateReadyVariationOrderLines(packageId)
      .then((result) => { if (active) setAuthority(Array.isArray(result?.lines) ? result.lines : []); })
      .catch((error) => { if (active) setFeedback({ type: 'error', message: error.message || 'Could not load Issued Variation Orders.' }); });
    return () => { active = false; };
  }, [packageId, certificate?.version]);

  const existing = useMemo(() => (certificate?.commercialLines || []).filter((line) => line.sourceType === 'variationOrder'), [certificate]);
  const existingKeys = new Set(existing.map((line) => `${line.variationOrderId}:${line.variationOrderLineId}`));
  const eligible = authority.filter((line) => line.eligible && !existingKeys.has(`${line.variationOrderId}:${line.variationOrderLineId}`));
  const exceptions = authority.filter((line) => line.overCertifiedAmount > 0);
  const selected = authority.find((line) => `${line.variationOrderId}:${line.variationOrderLineId}` === selectedKey) || null;

  async function add() {
    if (!selected) return;
    const result = await Promise.resolve(addVariationOrderLineToCertificate(orderKey, certificate.id, selected, amounts[selectedKey], order));
    if (!result.ok) return setFeedback({ type: 'error', message: result.errors?.[0] || 'Could not add Issued Variation Order.' });
    setSelectedKey(''); setFeedback(null); onLinesChanged?.();
  }

  if (!editable) return null;

  return <div className="po-cert-ce-add po-cert-ce-add--variation-orders">
    <h4 className="po-cert-ce-add__label">Add Issued Variation Order</h4>
    <p className="po-cert-detail__matrix-lead">Formally instructed VO lines available for valuation on this certificate.</p>
    {feedback ? <div className={`po-list-feedback po-list-feedback--${feedback.type}`} role="alert">{feedback.message}</div> : null}
    {editable && eligible.length ? <div className="po-cert-ce-add"><label className="po-cert-ce-add__label" htmlFor="po-cert-vo-select">Add Issued VO line</label><div className="po-cert-ce-add__controls"><select id="po-cert-vo-select" className="input" value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}><option value="">Select Issued Variation Order…</option>{eligible.map((line) => <option key={`${line.variationOrderId}:${line.variationOrderLineId}`} value={`${line.variationOrderId}:${line.variationOrderLineId}`}>{line.variationOrderReference} · {line.costCode} · {line.description} · {signed(line.remainingCertifiableValue)} remaining</option>)}</select><input type="number" step="0.01" className="input po-cert-ce-add__amount" disabled={!selected} value={selected ? amounts[selectedKey] ?? '' : ''} onChange={(event) => setAmounts((current) => ({ ...current, [selectedKey]: event.target.value }))} placeholder="This certificate £"/><button type="button" className="po-list-btn-secondary" disabled={!selected} onClick={add}>Add to certificate</button></div>{selected ? <dl className="po-cert-ce-add__preview"><div className="po-cert-ce-add__preview-row"><dt>Issued value:</dt><dd>{signed(selected.issuedLineValue)}</dd></div><div className="po-cert-ce-add__preview-row"><dt>Previously certified:</dt><dd>{signed(selected.previouslyCertifiedValue)}</dd></div><div className="po-cert-ce-add__preview-row"><dt>Available this certificate:</dt><dd>{signed(selected.remainingCertifiableValue)}</dd></div></dl> : null}</div> : null}
    {exceptions.length ? <div className="po-list-feedback po-list-feedback--warning" role="status">{exceptions.map((line) => <p key={`${line.variationOrderId}:${line.variationOrderLineId}`}>{line.variationOrderReference} · {line.costCode}: {line.exception}</p>)}</div> : null}
    {!eligible.length ? <p className="po-cert-detail__readonly-note">No eligible Issued Variation Orders are available for this package.</p> : null}
  </div>;
}
