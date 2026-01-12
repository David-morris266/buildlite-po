// client/src/POForm.jsx
import React, { useEffect, useMemo, useState } from 'react';
import CostCodeSelect from './CostCodeSelect';
import SupplierSelect from './SupplierSelect';
import JobSelect from './JobSelect';
import {
  listJobs,
  savePO,
  updatePO,
  requestApproval,
} from '../api';
import './POForm.css';

const toNumber = (v) => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const UOMS = [
  'nr','m','m2','m3','mm','cm',
  'hr','day','week',
  'ea','set','pair','thou',
  'kg','t',
  'l','gal',
  'ls'
];

/**
 * POForm
 * - create mode:  <POForm />
 * - edit mode:    <POForm initialPo={po} onSaved={fn} />
 */
export default function POForm({ initialPo = null, onSaved = null }) {
  const isEdit = !!(initialPo && initialPo.poNumber);

  // Supplier (id + name)
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');

  // Order type (M / S / P)
  const [type, setType] = useState('M');

  // Job selection
  const [jobId, setJobId] = useState('');
  const [jobSnap, setJobSnap] = useState(null);

  // Legacy / manual job code
  const [jobCode, setJobCode] = useState('');

  // Single cost code string
  const [costCode, setCostCode] = useState('');

  const [title, setTitle] = useState('');
  const [vatRate, setVatRate] = useState(0.2);

  // Lines
  const [lines, setLines] = useState([
    { description: '', uom: 'nr', qty: '', rate: '', amount: 0 },
  ]);

  // ---- Clause state (for sub-contract / plant) ----
  const [clauseTender, setClauseTender] = useState(false);
  const [clauseTenderDate, setClauseTenderDate] = useState('');
  const [clauseTerms, setClauseTerms] = useState(false);
  const [clauseTermsVersion, setClauseTermsVersion] = useState('');
  const [clauseRAMS, setClauseRAMS] = useState(false);
  // -------------------------------------------------

  const [savingDraft, setSavingDraft] = useState(false);
  const [savingAndSending, setSavingAndSending] = useState(false);

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

  // ===== Load selected job snapshot =====
  useEffect(() => {
    if (!jobId) { setJobSnap(null); return; }
    (async () => {
      try {
        const jobs = await listJobs();
        const found = (jobs || []).find(j => String(j.id) === String(jobId)) || null;
        setJobSnap(found || null);
        if (found && (found.jobNumber || found.jobCode)) {
          setJobCode(found.jobNumber || found.jobCode || '');
        } else {
          setJobCode('');
        }
      } catch {
        setJobSnap(null);
      }
    })();
  }, [jobId]);

  // ===== If editing, initialise state from initialPo =====
  useEffect(() => {
    if (!initialPo) return;

    // Supplier
    setSupplierId(
      initialPo.supplierId ||
      initialPo.supplierSnapshot?.id ||
      ''
    );
    setSupplierName(
      initialPo.supplierSnapshot?.name ||
      initialPo.supplierName ||
      ''
    );

    // Type
    setType(initialPo.type || 'M');

    // Job
    if (initialPo.job && initialPo.job.id) {
      setJobId(initialPo.job.id);
      setJobSnap(initialPo.job);
      setJobCode(
        initialPo.costRef?.jobCode ||
        initialPo.job.jobNumber ||
        initialPo.job.jobCode ||
        ''
      );
    } else {
      setJobId('');
      setJobSnap(initialPo.job || null);
      setJobCode(initialPo.costRef?.jobCode || '');
    }

    // Cost code
    setCostCode(initialPo.costRef?.costCode || '');

    // Title
    setTitle(initialPo.title || '');

    // VAT
    const vr =
      initialPo.vatRateDefault != null
        ? initialPo.vatRateDefault
        : (initialPo.totals?.vatRate ?? 0.2);
    setVatRate(vr);

    // Lines
    const mappedLines = Array.isArray(initialPo.items)
      ? initialPo.items.map(it => ({
          description: it.description || '',
          uom: it.uom || it.unit || 'nr',
          qty: it.qty != null ? String(it.qty) : '',
          rate: it.rate != null ? String(it.rate) : '',
          amount: toNumber(
            it.amount != null
              ? it.amount
              : toNumber(it.qty) * toNumber(it.rate)
          ),
        }))
      : [{ description: '', uom: 'nr', qty: '', rate: '', amount: 0 }];
    setLines(mappedLines);

    // Clauses
    const c = initialPo.clauses || {};
    setClauseTender(!!c.tenderRefEnabled);
    setClauseTenderDate(c.tenderRefDate || '');
    setClauseTerms(!!c.termsEnabled);
    setClauseTermsVersion(c.termsVersion || '');
    setClauseRAMS(!!c.ramsRequired);
  }, [initialPo]);

  const projectLabel = useMemo(() => {
    if (!jobSnap) return '';
    const tag = jobSnap.jobNumber || jobSnap.jobCode || '';
    return [jobSnap.name, tag].filter(Boolean).join(' · ');
  }, [jobSnap]);

  // ===== Common validation =====
  function validate() {
    const costCodeString =
      typeof costCode === 'string'
        ? costCode
        : (costCode && costCode.code) || '';

    if (!supplierId) {
      alert('Supplier is required');
      return { ok: false };
    }
    if (!costCodeString || !costCodeString.trim()) {
      alert('Cost code is required');
      return { ok: false };
    }
    if (lines.length === 0 || lines.every(l => !l.description && !toNumber(l.amount))) {
      alert('Add at least one order line');
      return { ok: false };
    }
    if (!['M','S','P'].includes(type)) {
      alert('Order Type must be M, S or P');
      return { ok: false };
    }

    return { ok: true, costCodeString };
  }

  // ===== Build payload (shared by create + update) =====
  function buildPayload(costCodeString) {
    const clauses = {
      tenderRefEnabled: clauseTender,
      tenderRefDate: clauseTenderDate,
      termsEnabled: clauseTerms,
      termsVersion: clauseTermsVersion,
      ramsRequired: clauseRAMS,
    };

    return {
      type,
      supplierId,
      supplierName,

      costRef: {
        jobId: jobSnap?.id || '',
        jobCode: jobSnap?.jobCode || jobSnap?.jobNumber || jobCode || '',
        costCode: costCodeString,
        element: ''
      },

      job: jobSnap ? {
        id: jobSnap.id,
        jobCode: jobSnap.jobCode || '',
        jobNumber: jobSnap.jobNumber || '',
        name: jobSnap.name || '',
        siteAddress: jobSnap.siteAddress || '',
        siteManager: jobSnap.siteManager || '',
        sitePhone: jobSnap.sitePhone || '',
        client: jobSnap.client || '',
        notes: jobSnap.notes || ''
      } : null,

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
          costCode: costCodeString
        })),

      amount: subtotal,
      createdBy: 'david@dmcc',

      clauses,
    };
  }

  // ===== Reset form back to clean state =====
  function resetForm() {
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

    setClauseTender(false);
    setClauseTenderDate('');
    setClauseTerms(false);
    setClauseTermsVersion('');
    setClauseRAMS(false);
  }

  // ===== Save Draft =====
  async function handleSaveDraft() {
    const { ok, costCodeString } = validate();
    if (!ok) return;

    const body = buildPayload(costCodeString);

    try {
      setSavingDraft(true);

      let po;
      if (isEdit && initialPo?.poNumber) {
        // Update existing Draft/Rejected
        po = await updatePO(initialPo.poNumber, {
          ...body,
          updatedBy: 'david@dmcc',
        });
      } else {
        // New Draft
        po = await savePO({
          ...body,
          status: 'Draft',
        });
      }

      alert(`PO ${po.poNumber || ''} saved as Draft`);

      if (!isEdit) {
        resetForm();
      }

      if (onSaved) onSaved(po);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Save failed');
    } finally {
      setSavingDraft(false);
    }
  }

  // ===== Save & Send for Approval =====
  async function handleSaveAndSend() {
    const { ok, costCodeString } = validate();
    if (!ok) return;

    const body = buildPayload(costCodeString);

    try {
      setSavingAndSending(true);

      let poNumber = initialPo?.poNumber || null;

      // 1) Create or update PO as Draft
      if (isEdit && initialPo?.poNumber) {
        const po = await updatePO(initialPo.poNumber, {
          ...body,
          updatedBy: 'david@dmcc',
        });
        poNumber = po.poNumber;
      } else {
        const po = await savePO({
          ...body,
          status: 'Draft',
        });
        poNumber = po.poNumber;
      }

      if (!poNumber) throw new Error('PO number missing after save');

      // 2) Request approval
      const poAfter = await requestApproval(poNumber, {
        by: 'david@dmcc',
        note: '',
      });

      alert(`PO ${poAfter.poNumber || ''} sent for approval`);

      if (!isEdit) {
        resetForm();
      }

      if (onSaved) onSaved(poAfter);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Save & Send failed');
    } finally {
      setSavingAndSending(false);
    }
  }

  return (
    <div className="po-form-container">
      <h2>
        {isEdit
          ? `Edit Purchase Order${initialPo?.poNumber ? ` – ${initialPo.poNumber}` : ''}`
          : 'New Purchase Order'}
      </h2>

      {/* Header inputs */}
      <div className="po-form-grid">
        <div>
          {/* SupplierSelect already renders its own label */}
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

        <div>
          <label>Job</label>
          <JobSelect value={jobId} onChange={setJobId} showLabel={false} />
          {jobSnap && (
            <div className="muted" style={{ marginTop: 4 }}>
              {projectLabel}<br />
              {jobSnap.siteAddress || ''}
              {jobSnap.siteManager ? ` · ${jobSnap.siteManager}` : ''}
              {jobSnap.sitePhone ? ` · ${jobSnap.sitePhone}` : ''}
            </div>
          )}
        </div>

        <div>
          <label>Job Code (optional)</label>
          <input
            placeholder="e.g. CO-CP-001"
            value={jobCode}
            onChange={(e) => setJobCode(e.target.value)}
          />
        </div>

        <div>
          {/* CostCodeSelect renders its own label */}
          <CostCodeSelect
  value={costCode}
  onChange={(label, fullObj) => {
    setCostCode(label);
  }}
/>
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

      {/* Clauses section – only for Subcontract / Plant */}
      {(type === 'S' || type === 'P') && (
        <div className="po-lines-card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Contract Clauses / References</h3>

          <div className="clause-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={clauseTender}
                onChange={e => setClauseTender(e.target.checked)}
              />
              <span>Refer to Cotswold Oak tender enquiry dated</span>
              <input
                type="text"
                placeholder="e.g. 10/06/2025"
                value={clauseTenderDate}
                onChange={e => setClauseTenderDate(e.target.value)}
                disabled={!clauseTender}
                style={{ maxWidth: 140 }}
              />
            </label>
          </div>

          <div className="clause-row" style={{ marginTop: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={clauseTerms}
                onChange={e => setClauseTerms(e.target.checked)}
              />
              <span>Refer to Cotswold Oak sub-contract terms and conditions version</span>
              <input
                type="text"
                placeholder="e.g. v1.0"
                value={clauseTermsVersion}
                onChange={e => setClauseTermsVersion(e.target.value)}
                disabled={!clauseTerms}
                style={{ maxWidth: 100 }}
              />
            </label>
          </div>

          <div className="clause-row" style={{ marginTop: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={clauseRAMS}
                onChange={e => setClauseRAMS(e.target.checked)}
              />
              <span>RAMS must be supplied and vetted prior to start on site.</span>
            </label>
          </div>
        </div>
      )}

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

      {/* Save buttons */}
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        <button
          onClick={handleSaveDraft}
          className="primary"
          style={{ width: '100%' }}
          disabled={savingDraft || savingAndSending}
        >
          {savingDraft
            ? (isEdit ? 'Saving Draft…' : 'Saving Draft…')
            : (isEdit ? 'Save Draft Changes' : 'Save Draft')}
        </button>

        <button
          onClick={handleSaveAndSend}
          className="secondary"
          style={{ width: '100%' }}
          disabled={savingDraft || savingAndSending}
        >
          {savingAndSending
            ? (isEdit ? 'Updating & Sending…' : 'Saving & Sending…')
            : (isEdit ? 'Save Changes & Send for Approval' : 'Save & Send for Approval')}
        </button>
      </div>
    </div>
  );
}
