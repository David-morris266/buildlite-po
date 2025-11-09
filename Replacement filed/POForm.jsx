import React, { useEffect, useMemo, useState } from 'react';
import CostCodeSelect from './CostCodeSelect';
import SupplierSelect from './SupplierSelect';
import JobSelect from './JobSelect'; // ⬅️ NEW
import './POForm.css';

const toNumber = (v) => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// UoM options (edit as you like)
const UOMS = [
  'nr','m','m2','m3','mm','cm',
  'hr','day','week',
  'ea','set','pair','thou',
  'kg','t',
  'l','gal',
  'ls' // lump sum
];

export default function POForm() {
  // Supplier: keep BOTH id and name
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');

  // Header fields
  const [type, setType] = useState('M');   // M / S / P

  // --- JOB FIELDS (NEW) ---
  const [jobId, setJobId] = useState('');        // selected job id from JobSelect
  const [jobSnap, setJobSnap] = useState(null);  // full job snapshot (from /api/jobs/:id)
  // -------------------------

  const [jobCode, setJobCode] = useState('');    // legacy/manual job code (kept)
  const [costCode, setCostCode] = useState('');
  const [title, setTitle] = useState('');
  const [vatRate, setVatRate] = useState(0.2);

  // Lines
  const [lines, setLines] = useState([
    { description: '', uom: 'nr', qty: '', rate: '', amount: 0 },
  ]);

  const addLine = () => {
    setLines(prev => [...prev, { description: '', uom: 'nr', qty: '', rate: '', amount: 0 }]);
  };

  const removeLine = (idx) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx, field, value) => {
    setLines(prev => {
      const next = [...prev];
      const row = { ...next[idx], [field]: value };
      const qty  = toNumber(field === 'qty'  ? value : row.qty);
      const rate = toNumber(field === 'rate' ? value : row.rate);
      row.amount = qty * rate;
      next[idx] = row;
      return next;
    });
  };

  const subtotal = lines.reduce((s, r) => s + toNumber(r.amount), 0);
  const vatAmt   = subtotal * toNumber(vatRate);
  const gross    = subtotal + vatAmt;

  // ===== JOB LOADING (NEW) =====
  useEffect(() => {
    if (!jobId) { setJobSnap(null); return; }
    (async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        if (!res.ok) throw new Error('Job not found');
        const data = await res.json();
        setJobSnap(data);
        // Optional: pre-fill legacy jobCode for now so your list/search still works
        setJobCode(data.jobNumber || '');
      } catch {
        setJobSnap(null);
      }
    })();
  }, [jobId]);

  const projectLabel = useMemo(() => {
    if (!jobSnap) return '';
    // e.g. “Badsey 35 (0753)”
    return `${jobSnap.name}${jobSnap.jobNumber ? ` (${jobSnap.jobNumber})` : ''}`;
  }, [jobSnap]);
  // =============================

  async function savePO() {
    // VALIDATION
    if (!supplierId) { alert('Supplier is required'); return; }
    if (!costCode.trim()) { alert('Cost code is required'); return; }
    if (lines.length === 0 || lines.every(l => !l.description && !toNumber(l.amount))) {
      alert('Add at least one order line'); return;
    }
    if (!['M','S','P'].includes(type)) {
      alert('Order Type must be M, S or P'); return;
    }

    // Build payload
    const body = {
      type,                       // drives PO number prefix
      supplierId,
      supplierName,               // optional; server snapshots supplier anyway

      // Map job into costRef for back-compat (existing server filters)
      costRef: {
        jobId: jobSnap?.id || '',
        jobCode: jobSnap?.jobNumber || jobCode || '',
        costCode,
        element: ''
      },

      // Also send a full job snapshot (used by PDF and future features)
      job: jobSnap ? {
        id: jobSnap.id,
        jobNumber: jobSnap.jobNumber || '',
        name: jobSnap.name || '',
        address1: jobSnap.address1 || '',
        address2: jobSnap.address2 || '',
        town: jobSnap.town || '',
        postcode: jobSnap.postcode || '',
        siteManager: jobSnap.siteManager || '',
        sitePhone: jobSnap.sitePhone || ''
      } : null,

      // Nice default title if empty
      title: title?.trim() || (jobSnap ? `PO · ${jobSnap.name}` : ''),

      vatRateDefault: toNumber(vatRate),
      items: lines
        .filter(l => l.description || toNumber(l.amount) > 0)
        .map(l => ({
          description: l.description || '',
          uom: l.uom || 'nr',
          qty: toNumber(l.qty),
          rate: toNumber(l.rate),
          amount: toNumber(l.amount),
          costCode
        })),
      amount: subtotal,           // legacy validation; server also recomputes
      createdBy: 'david@dmcc'
    };

    try {
      const res = await fetch('/api/po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Save failed (${res.status})`);
      }
      const po = await res.json();
      alert(`PO ${po.poNumber || 'saved'} successfully`);

      // Reset form
      setSupplierId('');
      setSupplierName('');
      setType('M');
      setJobId('');
      setJobSnap(null);
      setJobCode('');
      setCostCode('');
      setTitle('');
      setVatRate(0.2);
      setLines([{ description: '', uom: 'nr', qty: '', rate: '', amount: 0 }]);
    } catch (e) {
      console.error(e);
      alert(e.message);
    }
  }

  return (
    <div className="po-form-container">
      <h2>New Purchase Order</h2>

      {/* Header inputs */}
      <div className="po-form-grid">
        <div>
          <label>Select supplier…</label>
          <SupplierSelect
            value={supplierId}
            onChange={(sel) => {
              setSupplierId(sel?.id || '');
              setSupplierName(sel?.name || '');
            }}
          />
        </div>

        <div>
          <label>Order Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="M">Materials</option>
            <option value="S">Subcontract</option>
            <option value="P">Plant</option>
          </select>
        </div>

        {/* --- JOB PICKER (NEW) --- */}
        <div>
          <label>Job</label>
          <JobSelect value={jobId} onChange={setJobId} />
          {jobSnap && (
            <div className="muted" style={{ marginTop: 4 }}>
              {projectLabel}<br />
              {[jobSnap.address1, jobSnap.address2].filter(Boolean).join(', ')}
              {jobSnap.town ? `, ${jobSnap.town}` : ''} {jobSnap.postcode || ''}<br />
              {jobSnap.siteManager || ''}{jobSnap.sitePhone ? ` · ${jobSnap.sitePhone}` : ''}
            </div>
          )}
        </div>
        {/* ------------------------ */}

        {/* Kept for back-compat / manual override if needed */}
        <div>
          <label>Job Code (optional)</label>
          <input
            placeholder="e.g. CO-CP-001"
            value={jobCode}
            onChange={(e) => setJobCode(e.target.value)}
          />
        </div>

        <div>
          <label>Cost Code</label>
          <CostCodeSelect value={costCode} onChange={setCostCode} />
        </div>

        <div>
          <label>Title / Description</label>
          <input
            placeholder="Short PO description"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label>VAT Rate</label>
          <select
            value={vatRate}
            onChange={(e) => setVatRate(parseFloat(e.target.value))}
          >
            <option value={0}>0%</option>
            <option value={0.05}>5%</option>
            <option value={0.2}>20%</option>
          </select>
        </div>
      </div>

      {/* Lines toolbar */}
      <div className="po-form-toolbar">
        <button type="button" className="quiet" onClick={addLine}>
          + Add Line
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Tip: use Tab to move across, Enter to add more lines.
        </div>
      </div>

      {/* Lines table */}
      <div className="po-lines-card">
        <table className="po-lines-table">
          <thead>
            <tr>
              <th className="po-col-desc">Description</th>
              <th className="po-col-uom">UoM</th>
              <th className="po-col-qty">Qty</th>
              <th className="po-col-rate">Rate</th>
              <th className="po-col-amt">Amount</th>
              <th className="po-col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((r, idx) => (
              <tr key={idx}>
                <td>
                  <input
                    value={r.description}
                    onChange={(e) => updateLine(idx, 'description', e.target.value)}
                    placeholder="e.g. C30 concrete"
                  />
                </td>
                <td>
                  <select
                    value={r.uom}
                    onChange={(e) => updateLine(idx, 'uom', e.target.value)}
                  >
                    {UOMS.map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    value={r.qty}
                    onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    style={{ textAlign: 'right' }}
                  />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    value={r.rate}
                    onChange={(e) => updateLine(idx, 'rate', e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    style={{ textAlign: 'right' }}
                  />
                </td>
                <td style={{ textAlign: 'right' }}>
                  £{toNumber(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button
                    onClick={() => removeLine(idx)}
                    className="quiet"
                    title="Remove line"
                    style={{ width: 36 }}
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 240px',
          gap: 8,
          marginTop: 12,
        }}
      >
        <div />
        <div className="po-totals">
          <div className="po-total-row">
            <span>Net</span>
            <b>
              £{subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </b>
          </div>
          <div className="po-total-row">
            <span>VAT ({(vatRate * 100).toFixed(0)}%)</span>
            <b>
              £{vatAmt.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </b>
          </div>
          <div className="po-total-row po-total-divider">
            <span>Gross</span>
            <b>
              £{gross.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </b>
          </div>
        </div>
      </div>

      {/* Save */}
      <div style={{ marginTop: 12 }}>
        <button onClick={savePO} className="primary" style={{ width: '100%' }}>
          Save Purchase Order
        </button>
      </div>
    </div>
  );
}




























