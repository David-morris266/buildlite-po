import { useEffect, useMemo, useState } from 'react';
import {
  getActiveFamilyNames,
  getActiveHeadNames,
  getActiveTradeNames,
} from '../../admin/commercialStructureStore';
import {
  FORECAST_DRIVER_KEYS,
  SEMANTIC_GROUP_KEYS,
  forecastDriverLabel,
  lookupClassification,
  indexClassificationsByKey,
  semanticGroupLabel,
  unmappedClassification,
} from '../../admin/costCodeClassification';
import {
  ensureAdminCostCodesReady,
  getAdminCostCodeReadiness,
  isAdminCostCodeServerAuthority,
  listAdminCostCodeRecords,
  retryAdminCostCodes,
  saveAdminCostCode,
  searchAdminCostCodeRecords,
} from '../../admin/costCodeAdminService';
import {
  CostCodeClassificationApiError,
  listCostCodeClassifications,
  putCostCodeClassification,
} from '../../api/costCodeClassifications';
import AdminPageShell from './AdminPageShell';
import {
  AdminButton,
  AdminEmptyState,
  AdminKpiGrid,
  AdminSkeleton,
  AdminStatusBadge,
} from './adminUi';

const EMPTY_FORM = {
  code: '',
  description: '',
  commercialHead: '',
  commercialFamily: '',
  trade: '',
  reportingOrder: 0,
  active: true,
  defaultVatTreatment: 'Standard',
  defaultOrderType: 'S',
  allowBudget: true,
  allowPurchaseOrders: true,
  allowLedgerImport: true,
  allowForecastAdjustment: true,
  notes: '',
  version: 1,
};

function boolSelect(value, onChange) {
  return (
    <select className="input" value={value ? 'yes' : 'no'} onChange={(e) => onChange(e.target.value === 'yes')}>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
  );
}

export default function AdminCostCodesPage({ onBack }) {
  const serverAuthority = isAdminCostCodeServerAuthority();
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterHead, setFilterHead] = useState('');
  const [filterTrade, setFilterTrade] = useState('');
  const [filterActive, setFilterActive] = useState('all');
  const [filterOrderType, setFilterOrderType] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isNew, setIsNew] = useState(false);
  const [filterGroup, setFilterGroup] = useState('');
  const [classificationsByKey, setClassificationsByKey] = useState(() => new Map());
  const [classification, setClassification] = useState(() => unmappedClassification(''));
  const [classificationError, setClassificationError] = useState('');
  const [classificationSaving, setClassificationSaving] = useState(false);
  const [masterError, setMasterError] = useState('');
  const [partialSaveMessage, setPartialSaveMessage] = useState('');
  const [conflict, setConflict] = useState(false);

  async function loadClassifications() {
    try {
      const result = await listCostCodeClassifications();
      setClassificationsByKey(indexClassificationsByKey(result?.classifications || []));
      setClassificationError('');
    } catch (err) {
      setClassificationsByKey(new Map());
      setClassificationError(
        err instanceof CostCodeClassificationApiError
          ? err.message
          : 'Could not load BuildLite classifications.'
      );
    }
  }

  async function loadMaster() {
    setLoading(true);
    setMasterError('');
    setConflict(false);
    try {
      await ensureAdminCostCodesReady();
      setRefresh((value) => value + 1);
    } catch (err) {
      if (serverAuthority) {
        setMasterError(err?.message || 'Could not load cost codes.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    Promise.all([loadMaster(), loadClassifications()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial mount only
  }, []);

  const readiness = getAdminCostCodeReadiness();
  const allRecords = useMemo(() => {
    void refresh;
    return listAdminCostCodeRecords();
  }, [refresh]);
  const masterUnresolved = serverAuthority && allRecords == null;
  const masterLoadedEmpty = serverAuthority && Array.isArray(allRecords) && allRecords.length === 0;

  const records = useMemo(() => {
    void refresh;
    let items = searchAdminCostCodeRecords(search, allRecords);
    if (items == null) return null;
    if (filterHead) items = items.filter((item) => item.commercialHead === filterHead);
    if (filterTrade) items = items.filter((item) => (item.reportingGroup || item.trade) === filterTrade);
    if (filterActive === 'active') items = items.filter((item) => item.active);
    if (filterActive === 'inactive') items = items.filter((item) => !item.active);
    if (filterOrderType !== 'all') items = items.filter((item) => item.defaultOrderType === filterOrderType);
    if (filterGroup) {
      items = items.filter((item) => lookupClassification(classificationsByKey, item.code).semanticGroup === filterGroup);
    }
    return items;
  }, [refresh, search, filterHead, filterTrade, filterActive, filterOrderType, filterGroup, classificationsByKey, allRecords]);

  const heads = getActiveHeadNames();
  const tradeOptions = [...new Set((allRecords || []).map((item) => item.reportingGroup || item.trade).filter(Boolean))].sort();
  const families = getActiveFamilyNames(form.commercialHead);
  const trades = getActiveTradeNames(form.commercialHead, form.commercialFamily);
  const showLoading = loading || (serverAuthority && readiness.loadState === 'loading');
  const showError = serverAuthority && (readiness.loadState === 'error' || Boolean(masterError)) && masterUnresolved;
  const listRecords = records || [];

  function selectRecord(record) {
    setSelectedId(record.id);
    setIsNew(false);
    setForm({
      ...EMPTY_FORM,
      ...record,
      trade: record.reportingGroup || record.trade || '',
    });
    setClassification(lookupClassification(classificationsByKey, record.code));
    setPartialSaveMessage('');
    setConflict(false);
    setMasterError('');
  }

  function startNew() {
    const commercialHead = heads[0] || '';
    setSelectedId('new');
    setIsNew(true);
    setForm({
      ...EMPTY_FORM,
      commercialHead,
      commercialFamily: '',
      trade: '',
    });
    setClassification(unmappedClassification(''));
    setPartialSaveMessage('');
    setConflict(false);
    setMasterError('');
  }

  async function saveClassificationForCode(code) {
    setClassificationSaving(true);
    try {
      const saved = await putCostCodeClassification(code, {
        version: classification.version || 0,
        semanticGroup: classification.semanticGroup,
        forecastDriver: classification.forecastDriver,
      });
      setClassification({
        id: saved.id || null,
        costCodeKey: saved.costCodeKey || code,
        exists: Boolean(saved.exists),
        semanticGroup: saved.semanticGroup,
        forecastDriver: saved.forecastDriver,
        version: saved.version || 0,
      });
      await loadClassifications();
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof CostCodeClassificationApiError
          ? err.message
          : 'Could not save BuildLite classification.';
      setClassificationError(message);
      return { ok: false, message };
    } finally {
      setClassificationSaving(false);
    }
  }

  async function saveRecord() {
    setPartialSaveMessage('');
    setMasterError('');
    setConflict(false);
    const previous = isNew ? null : (allRecords || []).find((item) => item.id === selectedId) || null;
    const result = await saveAdminCostCode({
      isNew,
      id: selectedId,
      form,
      previous,
    });

    if (!result.ok) {
      const message = result.message || result.errors?.[0] || 'Could not save cost code.';
      setMasterError(message);
      setConflict(Boolean(result.conflict));
      if (result.record) setForm({ ...EMPTY_FORM, ...result.record, trade: result.record.reportingGroup || result.record.trade || '' });
      if (!serverAuthority) window.alert(message);
      return;
    }

    setSelectedId(result.record.id);
    setIsNew(false);
    setForm({
      ...EMPTY_FORM,
      ...result.record,
      trade: result.record.reportingGroup || result.record.trade || '',
    });
    setRefresh((value) => value + 1);

    const classified = await saveClassificationForCode(result.record.code);
    if (!classified.ok) {
      const message = `Cost code saved, but classification could not be saved. ${classified.message}`;
      setPartialSaveMessage(message);
      if (!serverAuthority) window.alert(classified.message);
    }
  }

  const unclassifiedCount = (allRecords || []).filter(
    (item) => lookupClassification(classificationsByKey, item.code).semanticGroup === 'UNCLASSIFIED'
  ).length;
  const codeLocked = serverAuthority && !isNew;

  return (
    <AdminPageShell
      title="Cost Codes"
      lead="Master cost code records remain the commercial identity. BuildLite Group is engine taxonomy only and does not change CVR until a later forecast-driver slice."
      onBack={onBack}
      actions={<AdminButton variant="primary" onClick={startNew} disabled={showError}>Add Cost Code</AdminButton>}
    >
      {classificationError ? (
        <p className="admin-inline-warning" role="status">{classificationError}</p>
      ) : null}
      {partialSaveMessage ? (
        <p className="admin-inline-warning" role="status">{partialSaveMessage}</p>
      ) : null}
      {masterError ? (
        <p className="admin-inline-warning" role="alert">{masterError}</p>
      ) : null}
      {conflict ? (
        <p className="admin-inline-warning" role="status">
          This cost code was updated elsewhere. Reload and try again rather than overwriting.
        </p>
      ) : null}

      {showError ? (
        <AdminEmptyState
          icon="⚠"
          title="Could not load cost codes"
          message={masterError || readiness.error?.message || 'The Cost Code Master is unavailable. This is not an empty tenant.'}
          tone="warning"
        />
      ) : null}
      {showError ? (
        <div className="admin-form__actions">
          <AdminButton variant="primary" onClick={() => retryAdminCostCodes().then(loadMaster).catch((err) => setMasterError(err?.message || 'Could not load cost codes.'))}>
            Retry
          </AdminButton>
        </div>
      ) : null}

      {!showError && !masterUnresolved ? (
        <AdminKpiGrid
          items={[
            { label: 'Total Cost Codes', value: (allRecords || []).length },
            { label: 'Active', value: (allRecords || []).filter((item) => item.active).length, tone: 'success' },
            { label: 'Unclassified', value: unclassifiedCount, tone: unclassifiedCount ? 'warning' : 'muted' },
            { label: 'Filtered', value: listRecords.length },
          ]}
        />
      ) : null}

      <div className="admin-split-layout">
        <aside className="admin-split-layout__sidebar po-module-card">
          <div className="admin-filter-stack">
            <label className="admin-search">
              <span className="admin-search__label">Search</span>
              <input
                className="input admin-search__input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Code, description, reporting group, family or head"
                disabled={showError}
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Commercial Head</span>
              <select className="input" value={filterHead} onChange={(e) => setFilterHead(e.target.value)}>
                <option value="">All heads</option>
                {heads.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Trade / Reporting Group</span>
              <select className="input" value={filterTrade} onChange={(e) => setFilterTrade(e.target.value)}>
                <option value="">All reporting groups</option>
                {tradeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">BuildLite Group</span>
              <select className="input" value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)}>
                <option value="">All groups</option>
                {SEMANTIC_GROUP_KEYS.map((item) => (
                  <option key={item} value={item}>{item} — {semanticGroupLabel(item)}</option>
                ))}
              </select>
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Active</span>
              <select className="input" value={filterActive} onChange={(e) => setFilterActive(e.target.value)}>
                <option value="all">All</option>
                <option value="active">Active only</option>
                <option value="inactive">Inactive only</option>
              </select>
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Order Type</span>
              <select className="input" value={filterOrderType} onChange={(e) => setFilterOrderType(e.target.value)}>
                <option value="all">All</option>
                <option value="M">Materials</option>
                <option value="S">Subcontract</option>
                <option value="P">Plant</option>
              </select>
            </label>
          </div>

          <div className="admin-record-list">
            {showLoading ? <AdminSkeleton rows={6} /> : null}
            {showError ? (
              <p className="admin-form__hint">Cost codes are not shown because the server master has not loaded.</p>
            ) : null}
            {!showLoading && !showError && !masterUnresolved && listRecords.length === 0 ? (
              <AdminEmptyState
                icon="📋"
                title={masterLoadedEmpty && !search && !filterHead && !filterTrade && filterActive === 'all' ? 'No cost codes' : 'No cost codes found'}
                message={
                  masterLoadedEmpty && !search
                    ? 'This tenant has no cost codes on the server yet. This is a genuine empty master.'
                    : 'Adjust your search or filters, or add a new cost code.'
                }
              />
            ) : null}
            {!showLoading && !showError && listRecords.map((record) => {
              const recordClassification = lookupClassification(classificationsByKey, record.code);
              const unclassified = recordClassification.semanticGroup === 'UNCLASSIFIED';
              return (
              <button
                key={record.id}
                type="button"
                className={[
                  'admin-record-list__item',
                  selectedId === record.id ? 'admin-record-list__item--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => selectRecord(record)}
              >
                <span className="admin-record-list__code">{record.code}</span>
                <span className="admin-record-list__meta">{record.description || record.reportingGroup || record.trade}</span>
                <AdminStatusBadge tone={unclassified ? 'warning' : 'accent'}>
                  {unclassified ? 'Unclassified' : recordClassification.semanticGroup}
                </AdminStatusBadge>
                <AdminStatusBadge tone={record.active ? 'success' : 'muted'}>
                  {record.active ? 'Active' : 'Inactive'}
                </AdminStatusBadge>
              </button>
              );
            })}
          </div>
        </aside>

        <section className="admin-split-layout__detail po-module-card admin-property-panel">
          {selectedId && !showError ? (
            <form className="admin-property-form" onSubmit={(e) => { e.preventDefault(); saveRecord(); }}>
              <header className="admin-property-panel__header">
                <h2>{isNew ? 'New Cost Code' : form.code || 'Cost Code'}</h2>
                <p>{isNew ? 'Create a master cost code record.' : form.description || 'Edit cost code properties.'}</p>
              </header>

              <div className="admin-form__grid">
                <label className="dev-form__field">
                  <span className="dev-form__label">Cost Code</span>
                  <input
                    className="input"
                    value={form.code}
                    readOnly={codeLocked}
                    disabled={codeLocked}
                    aria-readonly={codeLocked ? 'true' : undefined}
                    onChange={(e) => {
                      if (codeLocked) return;
                      setForm((p) => ({ ...p, code: e.target.value }));
                    }}
                  />
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Description</span>
                  <input className="input" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Commercial Head</span>
                  <select className="input" value={form.commercialHead} onChange={(e) => {
                    const commercialHead = e.target.value;
                    setForm((p) => ({
                      ...p,
                      commercialHead,
                      commercialFamily: '',
                      trade: getActiveTradeNames(commercialHead, '')[0] || p.trade,
                    }));
                  }}>
                    {heads.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Commercial Family (optional)</span>
                  <select className="input" value={form.commercialFamily} onChange={(e) => {
                    const commercialFamily = e.target.value;
                    setForm((p) => ({
                      ...p,
                      commercialFamily,
                      trade: getActiveTradeNames(p.commercialHead, commercialFamily)[0] || p.trade,
                    }));
                  }}>
                    <option value="">— None (two-level structure)</option>
                    {families.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Reporting Group</span>
                  <select className="input" value={form.trade} onChange={(e) => setForm((p) => ({ ...p, trade: e.target.value, reportingGroup: e.target.value }))}>
                    <option value="">Select reporting group</option>
                    {trades.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">BuildLite Group</span>
                  <select
                    className="input"
                    value={classification.semanticGroup}
                    onChange={(e) => {
                      const semanticGroup = e.target.value;
                      setClassification((current) => ({
                        ...current,
                        semanticGroup,
                        forecastDriver:
                          semanticGroup === 'UNCLASSIFIED'
                            ? 'STANDARD_CVR'
                            : current.forecastDriver,
                      }));
                    }}
                  >
                    {SEMANTIC_GROUP_KEYS.map((item) => (
                      <option key={item} value={item}>{item} — {semanticGroupLabel(item)}</option>
                    ))}
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Forecast Method</span>
                  <select
                    className="input"
                    value={classification.forecastDriver}
                    disabled={classification.semanticGroup === 'UNCLASSIFIED'}
                    onChange={(e) => setClassification((current) => ({
                      ...current,
                      forecastDriver: e.target.value,
                    }))}
                  >
                    {FORECAST_DRIVER_KEYS.map((item) => (
                      <option key={item} value={item}>{item} — {forecastDriverLabel(item)}</option>
                    ))}
                  </select>
                </label>
                {classification.semanticGroup === 'UNCLASSIFIED' ? (
                  <p className="admin-form__hint admin-form__field--wide">
                    Unclassified codes keep Standard CVR forecasting. They are not treated as Other.
                  </p>
                ) : null}
                <label className="dev-form__field">
                  <span className="dev-form__label">Reporting Order</span>
                  <input className="input" type="number" value={form.reportingOrder ?? 0} onChange={(e) => setForm((p) => ({ ...p, reportingOrder: Number(e.target.value) || 0 }))} />
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Default VAT</span>
                  <select className="input" value={form.defaultVatTreatment} onChange={(e) => setForm((p) => ({ ...p, defaultVatTreatment: e.target.value }))}>
                    <option value="Standard">Standard</option>
                    <option value="Zero Rated">Zero Rated</option>
                    <option value="Reverse Charge">Reverse Charge</option>
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Default Order Type</span>
                  <select className="input" value={form.defaultOrderType} onChange={(e) => setForm((p) => ({ ...p, defaultOrderType: e.target.value }))}>
                    <option value="M">Materials</option>
                    <option value="S">Subcontract</option>
                    <option value="P">Plant</option>
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Allow Budget</span>
                  {boolSelect(form.allowBudget, (value) => setForm((p) => ({ ...p, allowBudget: value })))}
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Allow Purchase Orders</span>
                  {boolSelect(form.allowPurchaseOrders, (value) => setForm((p) => ({ ...p, allowPurchaseOrders: value })))}
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Allow Ledger Import</span>
                  {boolSelect(form.allowLedgerImport, (value) => setForm((p) => ({ ...p, allowLedgerImport: value })))}
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Allow Forecast Adjustment</span>
                  {boolSelect(form.allowForecastAdjustment, (value) => setForm((p) => ({ ...p, allowForecastAdjustment: value })))}
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Active</span>
                  {boolSelect(form.active, (value) => setForm((p) => ({ ...p, active: value })))}
                </label>
                <label className="dev-form__field admin-form__field--wide">
                  <span className="dev-form__label">Notes</span>
                  <textarea className="input" rows={4} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
                </label>
              </div>

              <div className="admin-form__actions">
                <AdminButton type="submit" variant="primary" disabled={classificationSaving}>
                  {classificationSaving ? 'Saving…' : 'Save Cost Code'}
                </AdminButton>
                {conflict ? (
                  <AdminButton
                    variant="secondary"
                    type="button"
                    onClick={() => retryAdminCostCodes().then(loadMaster)}
                  >
                    Reload
                  </AdminButton>
                ) : null}
                <AdminButton variant="secondary" type="button" onClick={() => { setSelectedId(null); setIsNew(false); }}>Close</AdminButton>
              </div>
            </form>
          ) : (
            <AdminEmptyState
              icon="📋"
              title="Select a cost code"
              message="Choose a record from the list or add a new cost code to edit properties."
            />
          )}
        </section>
      </div>
    </AdminPageShell>
  );
}
