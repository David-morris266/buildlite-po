import { useEffect, useMemo, useState } from 'react';
import {
  addCostCodeMasterRecord,
  ensureCostCodeMasterSeeded,
  searchCostCodeMasterRecords,
  updateCostCodeMasterRecord,
} from '../../admin/costCodeMasterStore';
import {
  getActiveFamilyNames,
  getActiveHeadNames,
  getActiveTradeNames,
} from '../../admin/commercialStructureStore';
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

  useEffect(() => {
    ensureCostCodeMasterSeeded()
      .then(() => setRefresh((value) => value + 1))
      .finally(() => setLoading(false));
  }, []);

  const allRecords = useMemo(() => {
    void refresh;
    return searchCostCodeMasterRecords('');
  }, [refresh]);

  const records = useMemo(() => {
    void refresh;
    let items = searchCostCodeMasterRecords(search);
    if (filterHead) items = items.filter((item) => item.commercialHead === filterHead);
    if (filterTrade) items = items.filter((item) => item.trade === filterTrade);
    if (filterActive === 'active') items = items.filter((item) => item.active);
    if (filterActive === 'inactive') items = items.filter((item) => !item.active);
    if (filterOrderType !== 'all') items = items.filter((item) => item.defaultOrderType === filterOrderType);
    return items;
  }, [refresh, search, filterHead, filterTrade, filterActive, filterOrderType]);

  const heads = getActiveHeadNames();
  const tradeOptions = [...new Set(allRecords.map((item) => item.trade).filter(Boolean))].sort();
  const families = getActiveFamilyNames(form.commercialHead);
  const trades = getActiveTradeNames(form.commercialHead, form.commercialFamily);

  function selectRecord(record) {
    setSelectedId(record.id);
    setIsNew(false);
    setForm({ ...record });
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
  }

  function saveRecord() {
    const result = isNew
      ? addCostCodeMasterRecord(form)
      : updateCostCodeMasterRecord(selectedId, form);

    if (!result.ok) {
      window.alert(result.errors?.[0]);
      return;
    }

    setSelectedId(result.record.id);
    setIsNew(false);
    setForm({ ...result.record });
    setRefresh((value) => value + 1);
  }

  return (
    <AdminPageShell
      title="Cost Codes"
      lead="Master cost code records — the commercial backbone for purchase orders, CVR and reporting."
      onBack={onBack}
      actions={<AdminButton variant="primary" onClick={startNew}>Add Cost Code</AdminButton>}
    >
      <AdminKpiGrid
        items={[
          { label: 'Total Cost Codes', value: allRecords.length },
          { label: 'Active', value: allRecords.filter((item) => item.active).length, tone: 'success' },
          { label: 'Inactive', value: allRecords.filter((item) => !item.active).length, tone: 'muted' },
          { label: 'Filtered', value: records.length },
        ]}
      />

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
            {loading ? <AdminSkeleton rows={6} /> : null}
            {!loading && records.length === 0 ? (
              <AdminEmptyState
                icon="📋"
                title="No cost codes found"
                message="Adjust your search or filters, or add a new cost code."
              />
            ) : null}
            {!loading && records.map((record) => (
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
                <span className="admin-record-list__meta">{record.reportingGroup || record.trade}</span>
                <AdminStatusBadge tone={record.active ? 'success' : 'muted'}>
                  {record.active ? 'Active' : 'Inactive'}
                </AdminStatusBadge>
              </button>
            ))}
          </div>
        </aside>

        <section className="admin-split-layout__detail po-module-card admin-property-panel">
          {selectedId ? (
            <form className="admin-property-form" onSubmit={(e) => { e.preventDefault(); saveRecord(); }}>
              <header className="admin-property-panel__header">
                <h2>{isNew ? 'New Cost Code' : form.code || 'Cost Code'}</h2>
                <p>{isNew ? 'Create a master cost code record.' : form.description || 'Edit cost code properties.'}</p>
              </header>

              <div className="admin-form__grid">
                <label className="dev-form__field">
                  <span className="dev-form__label">Cost Code</span>
                  <input className="input" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} />
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
                  <select className="input" value={form.trade} onChange={(e) => setForm((p) => ({ ...p, trade: e.target.value }))}>
                    <option value="">Select reporting group</option>
                    {trades.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
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
                <AdminButton type="submit" variant="primary">Save Cost Code</AdminButton>
                <AdminButton variant="secondary" onClick={() => { setSelectedId(null); setIsNew(false); }}>Close</AdminButton>
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
