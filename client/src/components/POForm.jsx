// client/src/components/POForm.jsx
import React, { useEffect, useRef, useState } from 'react';
import CostCodeSelect from './CostCodeSelect';
import SupplierSelect from './SupplierSelect';
import DevelopmentSelect, {
  DevelopmentSelectEmptyState,
} from './DevelopmentSelect';
import DevelopmentSummaryCard from './DevelopmentSummaryCard';
import {
  listDevelopments,
} from '../developments/developmentStore';
import {
  buildPoDevelopmentPayload,
  mapJobToDevelopment,
  resolvePoDevelopment,
} from '../developments/developmentPoHelpers';
import { savePoDevelopmentRef } from '../developments/poDevelopmentRefStore';
import {
  savePO,
  updatePO,
  requestApproval,
  getActiveBrand,
} from '../api';
import { notifyCommercialChanged } from '../commercial/commercialEvents';
import {
  getSuggestedOrderTypeForSupplier,
  isOrderTypeCompatible,
  getSupplierTypeMeta,
} from '../suppliers/supplierTypes';
import {
  buildRequestApprovalBody,
  getSetupApprovalRouting,
} from '../setup/setupDraft';
import POSaveJourneyPanel from './POSaveJourneyPanel';
import POPageHeader from './POPageHeader';
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
export default function POForm({
  initialPo = null,
  onSaved = null,
  setupLaunchSeed = null,
  onClearSetupLaunchSeed = null,
  onViewPurchaseOrders = null,
  onReviewAndApprove = null,
  onCreateAnotherPO = null,
  onCreateDevelopment = null,
}) {
  const isEdit = !!(initialPo && initialPo.poNumber);

  // Supplier (id + name)
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState(null);

  // Order type (M / S / P)
  const [type, setType] = useState('M');

  // Development selection (BL-009A.03)
  const [developmentId, setDevelopmentId] = useState('');

  const developments = listDevelopments();
  const hasDevelopments = developments.length > 0;
  const selectedDevelopment =
    developments.find((item) => item.id === developmentId) || null;
  const formDisabled = !hasDevelopments;

  // Single cost code string
  const [costCode, setCostCode] = useState('');

  const [title, setTitle] = useState('');
  const [vatRate, setVatRate] = useState(0.2);
  const [retentionRate, setRetentionRate] = useState(0.05);

  const [setupBanner, setSetupBanner] = useState(null);
  const [poNumberHint, setPoNumberHint] = useState('');
  const [setupSeedApplied, setSetupSeedApplied] = useState(false);
  const [companyLabel, setCompanyLabel] = useState('Your company');

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
  const [sendingFromDraftPanel, setSendingFromDraftPanel] = useState(false);
  const [activePoNumber, setActivePoNumber] = useState(
    initialPo?.poNumber || null
  );
  const [journeyPanel, setJourneyPanel] = useState(null);
  const [formNotice, setFormNotice] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const actionsRef = useRef(null);

  const persistedPoNumber = initialPo?.poNumber || activePoNumber;
  const isPersisted = !!persistedPoNumber;

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

  // Tenant brand for clause copy (normal PO); setup name only via launch seed
  useEffect(() => {
    if (setupLaunchSeed) return;
    (async () => {
      try {
        const { brand } = await getActiveBrand();
        const name = brand?.trading_name || brand?.legal_name;
        if (name) setCompanyLabel(name);
      } catch {
        /* keep default */
      }
    })();
  }, [setupLaunchSeed]);

  // Apply setup launch seed from App (BL-008 — survives Strict Mode remount)
  useEffect(() => {
    if (!setupLaunchSeed || isEdit || setupSeedApplied) return;

    const seed = setupLaunchSeed;

    setVatRate(seed.vatRate);
    setRetentionRate(seed.retentionRate);
    setType(seed.orderType || 'M');
    setPoNumberHint(seed.poNumberHint || '');

    if (seed.supplierId) {
      setSupplierId(seed.supplierId);
      if (seed.supplierName) setSupplierName(seed.supplierName);
    }

    if (seed.jobId || seed.job?.name) {
      const mapped = seed.job
        ? mapJobToDevelopment({
            name: seed.job.name,
            jobNumber: seed.job.jobCode,
            jobCode: seed.job.jobCode,
          })
        : null;
      if (mapped) {
        setDevelopmentId(mapped.id);
        setTitle(`PO · ${mapped.developmentName}`);
      } else if (seed.job?.name) {
        setTitle(`PO · ${seed.job.name}`);
      }
    }

    setSetupBanner({
      companyName: seed.companyName,
      paymentTerms: seed.paymentTerms,
      currency: seed.currency,
      poNumberHint: seed.poNumberHint,
    });

    if (seed.companyName) {
      setCompanyLabel(seed.companyName);
    }

    setSetupSeedApplied(true);
  }, [setupLaunchSeed, isEdit, setupSeedApplied]);

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
    setSelectedSupplier(initialPo.supplierSnapshot || null);

    // Type
    setType(initialPo.type || 'M');

    // Development
    const resolved = resolvePoDevelopment(initialPo);
    if (resolved.ref?.id) {
      setDevelopmentId(resolved.ref.id);
    } else if (resolved.live?.id) {
      setDevelopmentId(resolved.live.id);
    } else {
      setDevelopmentId('');
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

    const rr =
      initialPo.retentionRateDefault != null
        ? initialPo.retentionRateDefault
        : 0.05;
    setRetentionRate(rr);

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

  useEffect(() => {
    if (!developmentId || title.trim()) return;
    if (selectedDevelopment?.developmentName) {
      setTitle(`PO · ${selectedDevelopment.developmentName}`);
    }
  }, [developmentId, selectedDevelopment, title]);

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function scrollToActions() {
    actionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ===== Common validation =====
  function validate() {
    const costCodeString =
      typeof costCode === 'string'
        ? costCode
        : (costCode && costCode.code) || '';

    const errors = {};

    if (!supplierId) {
      errors.supplier = 'Supplier is required.';
    }
    if (!developmentId) {
      errors.development = 'Development is required.';
    }
    if (!costCodeString || !costCodeString.trim()) {
      errors.costCode = 'Cost code is required.';
    }
    if (
      lines.length === 0 ||
      lines.every((l) => !l.description && !toNumber(l.amount))
    ) {
      errors.lines = 'Add at least one order line.';
    }
    if (!['M', 'S', 'P'].includes(type)) {
      errors.type = 'Order type must be Materials, Subcontract, or Plant.';
    }
    if (
      selectedSupplier?.supplierType &&
      !isOrderTypeCompatible(selectedSupplier.supplierType, type)
    ) {
      const supplierLabel = getSupplierTypeMeta(selectedSupplier.supplierType)?.label;
      const suggested = getSuggestedOrderTypeForSupplier(selectedSupplier);
      errors.type = `${supplierLabel} suppliers usually require ${suggested === 'S' ? 'Subcontract' : suggested === 'P' ? 'Plant' : 'Materials'} orders. Change the order type to continue.`;
    }

    if (Object.keys(errors).length) {
      setFormErrors(errors);
      setSaveError('');
      scrollToTop();
      return { ok: false };
    }

    setFormErrors({});
    return { ok: true, costCodeString };
  }

  function showSentSuccess(poNumber) {
    const routing = getSetupApprovalRouting();

    if (routing.mode === 'self') {
      setJourneyPanel(null);
      setFormNotice({
        type: 'pending-review',
        poNumber,
        message: `Purchase Order ${poNumber} sent for approval.`,
        hint:
          'Review and approve from Purchase Orders whenever you are ready — this step stays available until you approve.',
      });
      scrollToActions();
      return;
    }

    setFormNotice(null);
    setJourneyPanel({
      variant: 'sent-for-approval',
      poNumber,
      approverName: routing.approverName || routing.approverEmail || 'Approver',
      approvalMode: 'other',
    });
    scrollToActions();
  }

  function sessionActor() {
    return localStorage.getItem('userEmail') || 'accounts@example.co.uk';
  }

  function persistDevelopmentRef(poNumber, development = selectedDevelopment) {
    if (!poNumber || !development?.id) return;
    savePoDevelopmentRef(poNumber, {
      developmentId: development.id,
      developmentNumber: development.jobNumber || '',
      developmentName: development.developmentName || '',
    });
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

      ...buildPoDevelopmentPayload(selectedDevelopment),

      costRef: {
        developmentId: selectedDevelopment?.id || '',
        costCode: costCodeString,
        element: '',
      },

      job: null,

      title:
        title?.trim() ||
        (selectedDevelopment
          ? `PO · ${selectedDevelopment.developmentName}`
          : ''),

      vatRateDefault: toNumber(vatRate),
      retentionRateDefault: toNumber(retentionRate),

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
      createdBy: sessionActor(),

      clauses,
    };
  }

  async function persistDraft(body) {
    if (isPersisted && persistedPoNumber) {
      return updatePO(persistedPoNumber, {
        ...body,
        updatedBy: sessionActor(),
      });
    }
    return savePO({
      ...body,
      status: 'Draft',
    });
  }

  // ===== Reset form back to clean state =====
  function resetForm() {
    setSupplierId('');
    setSupplierName('');
    setType('M');
    setDevelopmentId('');
    setCostCode('');
    setTitle('');
    setVatRate(0.2);
    setRetentionRate(0.05);
    setLines([{ description: '', uom: 'nr', qty: '', rate: '', amount: 0 }]);

    setSetupBanner(null);
    setPoNumberHint('');
    setSetupSeedApplied(false);

    setClauseTender(false);
    setClauseTenderDate('');
    setClauseTerms(false);
    setClauseTermsVersion('');
    setClauseRAMS(false);

    onClearSetupLaunchSeed?.();
    setActivePoNumber(null);
    setJourneyPanel(null);
    setFormNotice(null);
    setFormErrors({});
    setSaveError('');
  }

  function handleCreateAnother() {
    resetForm();
    onCreateAnotherPO?.();
  }

  // ===== Save Draft =====
  async function handleSaveDraft() {
    const { ok, costCodeString } = validate();
    if (!ok) return;

    const body = buildPayload(costCodeString);

    try {
      setSavingDraft(true);
      setSaveError('');

      const po = await persistDraft(body);
      const poNumber = po.poNumber || persistedPoNumber;

      if (poNumber) {
        setActivePoNumber(poNumber);
        persistDevelopmentRef(poNumber);
      }

      setJourneyPanel({
        variant: 'draft-saved',
        poNumber: poNumber || '',
      });
      scrollToActions();

      if (onSaved) onSaved(po);
      notifyCommercialChanged({ source: 'po-form', poNumber: po.poNumber || persistedPoNumber });
    } catch (e) {
      console.error(e);
      setSaveError(e.message || 'Could not save your Purchase Order. Please try again.');
      scrollToTop();
    } finally {
      setSavingDraft(false);
    }
  }

  async function sendForApproval(poNumber) {
    const poAfter = await requestApproval(
      poNumber,
      buildRequestApprovalBody()
    );
    return poAfter.poNumber || poNumber;
  }

  // ===== Save & Send for Approval =====
  async function handleSaveAndSend() {
    const { ok, costCodeString } = validate();
    if (!ok) return;

    const body = buildPayload(costCodeString);

    try {
      setSavingAndSending(true);
      setSaveError('');

      const po = await persistDraft(body);
      const poNumber = po.poNumber || persistedPoNumber;

      if (!poNumber) throw new Error('PO number missing after save');

      setActivePoNumber(poNumber);
      persistDevelopmentRef(poNumber);

      await sendForApproval(poNumber);
      showSentSuccess(poNumber);

      if (onSaved) onSaved(po);
      notifyCommercialChanged({ source: 'po-form', poNumber });
    } catch (e) {
      console.error(e);
      setSaveError(
        e.message || 'Could not send your Purchase Order for approval. Please try again.'
      );
      scrollToTop();
    } finally {
      setSavingAndSending(false);
    }
  }

  async function handleSendFromDraftPanel() {
    if (!persistedPoNumber) return;

    try {
      setSendingFromDraftPanel(true);
      setSaveError('');
      await sendForApproval(persistedPoNumber);
      showSentSuccess(persistedPoNumber);
    } catch (e) {
      console.error(e);
      setSaveError(
        e.message || 'Could not send your Purchase Order for approval. Please try again.'
      );
      scrollToTop();
    } finally {
      setSendingFromDraftPanel(false);
    }
  }

  const errorMessages = Object.values(formErrors);

  const pageTitle = isPersisted
    ? `Edit Purchase Order${persistedPoNumber ? ` – ${persistedPoNumber}` : ''}`
    : 'Create a new Purchase Order';

  const pageEyebrow = isPersisted ? 'Purchase orders' : 'New purchase order';

  const pageLead = isPersisted
    ? 'Update your order details and save your changes when you are ready.'
    : 'Create a Purchase Order, save a draft or send it for approval.';

  return (
    <div
      className={`po-form-container${journeyPanel ? ' po-form-container--journey' : ''}`}
    >
      <POPageHeader
        eyebrow={pageEyebrow}
        title={pageTitle}
        lead={pageLead}
      />

      {saveError ? (
        <div className="po-form-error-banner" role="alert">
          {saveError}
        </div>
      ) : null}

      {errorMessages.length > 0 ? (
        <div className="po-form-error-banner" role="alert">
          <p style={{ margin: '0 0 6px', fontWeight: 700 }}>
            Please check the following:
          </p>
          <ul>
            {errorMessages.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Form body — stays visible while confirmation replaces actions below */}
      <div className="po-form-body">
        {setupBanner ? (
          <div className="po-setup-banner" role="status">
            <span className="po-setup-banner__mark" aria-hidden="true">
              ✓
            </span>
            <span>
              From your setup
              {setupBanner.companyName ? ` · ${setupBanner.companyName}` : ''}
              {setupBanner.paymentTerms
                ? ` · ${setupBanner.paymentTerms}`
                : ''}
              {setupBanner.currency ? ` · ${setupBanner.currency}` : ''}
              {setupBanner.poNumberHint
                ? ` · PO numbers like ${setupBanner.poNumberHint.split(',')[0].trim()}`
                : ''}
            </span>
          </div>
        ) : null}

        {!hasDevelopments ? (
          <DevelopmentSelectEmptyState onCreateDevelopment={onCreateDevelopment} />
        ) : null}

        <fieldset className="po-form-sections" disabled={formDisabled}>
          {/* 1. Supplier */}
          <section className="po-form-section" aria-labelledby="po-section-supplier">
            <h2 id="po-section-supplier" className="po-form-section__title">
              Supplier
            </h2>
            <p className="po-form-section__lead">
              Choose who you are placing this order with.
            </p>
            <div className={formErrors.supplier ? 'po-field--error' : ''}>
              <SupplierSelect
                value={supplierId}
                onChange={(sel) => {
                  setSupplierId(sel?.id || '');
                  setSupplierName(sel?.name || '');
                }}
                onSelectFull={setSelectedSupplier}
                onSuggestedOrderType={(suggestedType) => {
                  if (suggestedType) setType(suggestedType);
                }}
              />
              {formErrors.supplier ? (
                <p className="po-field__inline-error">{formErrors.supplier}</p>
              ) : null}
            </div>
          </section>

          {/* 2. Development */}
          <section className="po-form-section" aria-labelledby="po-section-development">
            <h2 id="po-section-development" className="po-form-section__title">
              Development
            </h2>
            <p className="po-form-section__lead">
              Link this order to the development it belongs to. Commercial context
              is inherited from the Plot Master.
            </p>

            {!hasDevelopments ? (
              <p className="dev-po-empty__hint">
                Create a Development to unlock the rest of this form.
              </p>
            ) : (
              <>
                <div className={formErrors.development ? 'po-field--error' : ''}>
                  <DevelopmentSelect
                    value={developmentId}
                    disabled={formDisabled}
                    onChange={(id) => {
                      setDevelopmentId(id || '');
                      if (formErrors.development) {
                        setFormErrors((prev) => {
                          const next = { ...prev };
                          delete next.development;
                          return next;
                        });
                      }
                    }}
                  />
                  {formErrors.development ? (
                    <p className="po-field__inline-error">{formErrors.development}</p>
                  ) : null}
                </div>

                {selectedDevelopment ? (
                  <DevelopmentSummaryCard development={selectedDevelopment} />
                ) : null}
              </>
            )}
          </section>

          {/* 3. Order Details */}
          <section className="po-form-section" aria-labelledby="po-section-order">
            <h2 id="po-section-order" className="po-form-section__title">
              Order details
            </h2>
            <p className="po-form-section__lead">
              Set the order type, description and cost code for this purchase.
            </p>
            <div className="po-form-grid po-form-grid--3">
              <div className={formErrors.type ? 'po-field--error' : ''}>
                <label>Order Type</label>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="M">Materials</option>
                  <option value="S">Subcontract</option>
                  <option value="P">Plant</option>
                </select>
                {poNumberHint ? (
                  <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                    Numbering from setup: {poNumberHint}
                  </p>
                ) : null}
                {formErrors.type ? (
                  <p className="po-field__inline-error">{formErrors.type}</p>
                ) : null}
              </div>

              <div>
                <label>Title / Description</label>
                <input
                  placeholder="Short PO description"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className={formErrors.costCode ? 'po-field--error' : ''}>
                <CostCodeSelect
                  value={costCode}
                  onChange={(label) => {
                    setCostCode(label);
                    if (formErrors.costCode) {
                      setFormErrors((prev) => {
                        const next = { ...prev };
                        delete next.costCode;
                        return next;
                      });
                    }
                  }}
                />
                {formErrors.costCode ? (
                  <p className="po-field__inline-error">{formErrors.costCode}</p>
                ) : null}
              </div>
            </div>
          </section>

          {/* 4. Line Items */}
          <section
            className="po-form-section po-form-section--lines"
            aria-labelledby="po-section-lines"
          >
            <h2 id="po-section-lines" className="po-form-section__title">
              Line items
            </h2>
            <p className="po-form-section__lead">
              Add each item you are ordering, with quantity and rate.
            </p>

            <div className="po-form-toolbar">
              <button type="button" className="quiet" onClick={addLine}>
                + Add Line
              </button>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Tip: use Tab to move across, Enter to add more lines.
              </div>
            </div>

            <div className={`po-lines-card${formErrors.lines ? ' po-field--error' : ''}`}>
              {formErrors.lines ? (
                <p className="po-field__inline-error" style={{ padding: '8px 12px 0' }}>
                  {formErrors.lines}
                </p>
              ) : null}
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
          </section>

          {/* 5. Commercial Terms */}
          <section className="po-form-section" aria-labelledby="po-section-commercial">
            <h2 id="po-section-commercial" className="po-form-section__title">
              Commercial terms
            </h2>
            <p className="po-form-section__lead">
              VAT and retention applied to this order.
            </p>
            <div className="po-form-grid">
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

              <div>
                <label>Retention</label>
                <select
                  value={retentionRate}
                  onChange={(e) => setRetentionRate(parseFloat(e.target.value))}
                >
                  <option value={0}>None</option>
                  <option value={0.025}>2.5%</option>
                  <option value={0.05}>5%</option>
                  <option value={0.075}>7.5%</option>
                  <option value={0.1}>10%</option>
                </select>
              </div>
            </div>
          </section>

          {/* 6. Clauses — Subcontract / Plant only */}
          {(type === 'S' || type === 'P') && (
            <section
              className="po-form-section po-form-section--clauses"
              aria-labelledby="po-section-clauses"
            >
              <h2 id="po-section-clauses" className="po-form-section__title">
                Clauses
              </h2>
              <p className="po-form-section__lead">
                Optional contract references to include on the order.
              </p>

              <div className="clause-row">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={clauseTender}
                    onChange={e => setClauseTender(e.target.checked)}
                  />
                  <span>Refer to {companyLabel} tender enquiry dated</span>
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

              <div className="clause-row">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={clauseTerms}
                    onChange={e => setClauseTerms(e.target.checked)}
                  />
                  <span>Refer to {companyLabel} sub-contract terms and conditions version</span>
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

              <div className="clause-row">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={clauseRAMS}
                    onChange={e => setClauseRAMS(e.target.checked)}
                  />
                  <span>RAMS must be supplied and vetted prior to start on site.</span>
                </label>
              </div>
            </section>
          )}
        </fieldset>
      </div>

      {/* 7. Actions */}
      <section
        className="po-form-section po-form-section--actions"
        aria-labelledby="po-section-actions"
      >
        <h2 id="po-section-actions" className="po-form-section__title">
          Actions
        </h2>
        <div ref={actionsRef} className="po-form-actions">
          {formNotice ? (
            <div
              className="po-form-notice po-form-notice--success"
              role="status"
              aria-live="polite"
            >
              <button
                type="button"
                className="po-form-notice__close"
                onClick={() => setFormNotice(null)}
                aria-label="Dismiss notice"
              >
                ×
              </button>
              <p className="po-form-notice__title">{formNotice.message}</p>
              <p className="po-form-notice__hint">{formNotice.hint}</p>
              <div className="po-form-notice__actions">
                <button
                  type="button"
                  className="po-journey-panel__btn po-journey-panel__btn--primary"
                  onClick={() => {
                    onViewPurchaseOrders?.(
                      formNotice.poNumber || persistedPoNumber
                    );
                  }}
                >
                  Review in Purchase Orders
                </button>
              </div>
            </div>
          ) : journeyPanel ? (
            <POSaveJourneyPanel
              variant={journeyPanel.variant}
              poNumber={journeyPanel.poNumber}
              approverName={journeyPanel.approverName}
              approvalMode={journeyPanel.approvalMode}
              sendingFromDraft={sendingFromDraftPanel}
              onContinueEditing={() => setJourneyPanel(null)}
              onSendForApproval={handleSendFromDraftPanel}
              onViewPurchaseOrders={() => {
                onViewPurchaseOrders?.(
                  journeyPanel.poNumber || persistedPoNumber
                );
              }}
              onReviewAndApprove={() => {
                onReviewAndApprove?.(
                  journeyPanel.poNumber || persistedPoNumber
                );
              }}
              onCreateAnother={handleCreateAnother}
              onDismiss={() => setJourneyPanel(null)}
            />
          ) : (
            <>
              <button
                onClick={handleSaveDraft}
                className="primary"
                style={{ width: '100%' }}
                disabled={formDisabled || savingDraft || savingAndSending}
              >
                {savingDraft
                  ? 'Saving…'
                  : isPersisted
                    ? 'Save Draft Changes'
                    : 'Save Draft'}
              </button>

              <button
                onClick={handleSaveAndSend}
                className="secondary"
                style={{ width: '100%' }}
                disabled={formDisabled || savingDraft || savingAndSending}
              >
                {savingAndSending
                  ? 'Sending…'
                  : isPersisted
                    ? 'Save Changes & Send for Approval'
                    : 'Save & Send for Approval'}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
