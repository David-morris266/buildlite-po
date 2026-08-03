import { useEffect, useMemo, useState } from 'react';
import { createSupplier, listSuppliers, updateSupplier, approveSupplier } from '../../api';
import { notifyMasterDataChanged } from '../../admin/masterDataEvents';
import { SUPPLIER_TYPES } from '../../suppliers/supplierTypes';
import {
  formatSupplierApprovalAction,
  getSupplierApprovalBadge,
  isSupplierApproved,
} from '../../suppliers/supplierApproval';
import { getActiveHeadNames, getActiveTradeNames } from '../../admin/commercialStructureStore';
import AdminPageShell from './AdminPageShell';
import {
  AdminButton,
  AdminEmptyState,
  AdminKpiGrid,
  AdminSkeleton,
  AdminStatusBadge,
} from './adminUi';

const EMPTY_FORM = {
  name: '',
  supplierType: 'subcontractor',
  preferredTrade: '',
  preferredCommercialHead: '',
  termsDays: 30,
  creditAccount: false,
  cisStatus: '',
  insuranceExpiry: '',
  approvedSupplier: true,
  defaultVat: 'Standard',
  vatStatus: 'VAT Registered',
  active: true,
  notes: '',
};

function isInsuranceExpiring(value) {
  if (!value) return false;
  const expiry = new Date(value);
  if (Number.isNaN(expiry.getTime())) return false;
  const days = (expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return days >= 0 && days <= 30;
}

export default function AdminSuppliersPage({ onBack }) {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isNew, setIsNew] = useState(false);

  const headOptions = getActiveHeadNames();
  const tradeOptions = [
    ...new Set(headOptions.flatMap((head) => getActiveTradeNames(head, 'General').concat('General'))),
  ];

  async function loadSuppliers() {
    setLoading(true);
    try {
      const data = await listSuppliers('');
      setSuppliers(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSuppliers();
  }, []);

  const filteredSuppliers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return suppliers;
    return suppliers.filter((supplier) => {
      const haystack = [
        supplier.name,
        supplier.supplierType,
        supplier.preferredTrade,
        supplier.preferredCommercialHead,
        supplier.cisStatus,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [suppliers, search]);

  const pendingCount = suppliers.filter((item) => !isSupplierApproved(item)).length;
  const inactiveCount = suppliers.filter((item) => item.active === false).length;
  const insuranceDue = suppliers.filter((item) => isInsuranceExpiring(item.insuranceExpiry)).length;
  const cisVerified = suppliers.filter((item) => item.cisStatus && item.cisStatus !== 'Not Applicable').length;

  function selectSupplier(supplier) {
    setSelectedId(supplier.id);
    setIsNew(false);
    setForm({
      name: supplier.name || '',
      supplierType: supplier.supplierType || 'subcontractor',
      preferredTrade: supplier.preferredTrade || '',
      preferredCommercialHead: supplier.preferredCommercialHead || '',
      termsDays: supplier.termsDays ?? 30,
      creditAccount: Boolean(supplier.creditAccount),
      cisStatus: supplier.cisStatus || '',
      insuranceExpiry: supplier.insuranceExpiry || '',
      approvedSupplier: supplier.approvedSupplier !== false,
      defaultVat: supplier.defaultVat || 'Standard',
      vatStatus: supplier.vatStatus || 'VAT Registered',
      active: supplier.active !== false,
      notes: supplier.notes || '',
    });
  }

  function startNew() {
    setSelectedId('new');
    setIsNew(true);
    setForm(EMPTY_FORM);
  }

  async function handleApproveSupplier() {
    if (!selectedId || selectedId === 'new') return;
    setSaving(true);
    try {
      const approverName = localStorage.getItem('userName') || 'Administrator';
      const saved = await approveSupplier(selectedId, {
        by: approverName,
        note: 'Approved in Administration',
      });
      await loadSuppliers();
      selectSupplier(saved);
      notifyMasterDataChanged('suppliers');
    } finally {
      setSaving(false);
    }
  }

  async function saveSupplier() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        termsDays: Number(form.termsDays) || 30,
        creditAccount: Boolean(form.creditAccount),
        approvedSupplier: Boolean(form.approvedSupplier),
        active: Boolean(form.active),
      };

      if (isNew) {
        const created = await createSupplier(payload);
        setSelectedId(created.id);
        setIsNew(false);
      } else {
        await updateSupplier(selectedId, payload);
      }
      await loadSuppliers();
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminPageShell
      title="Suppliers"
      lead="Supplier master records used by purchase orders and payment certificates."
      onBack={onBack}
      actions={<AdminButton variant="primary" onClick={startNew}>Add Supplier</AdminButton>}
    >
      <AdminKpiGrid
        items={[
          { label: 'Total Suppliers', value: suppliers.length },
          { label: 'Pending Approval', value: pendingCount, tone: pendingCount ? 'warning' : 'success' },
          { label: 'Inactive', value: inactiveCount, tone: inactiveCount ? 'muted' : 'success' },
          { label: 'Insurance Due', value: insuranceDue, tone: insuranceDue ? 'warning' : 'success' },
          { label: 'CIS Verified', value: cisVerified },
        ]}
      />

      <div className="admin-split-layout">
        <aside className="admin-split-layout__sidebar po-module-card">
          <label className="admin-search">
            <span className="admin-search__label">Search suppliers</span>
            <input
              className="input admin-search__input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, trade, head, CIS status…"
            />
          </label>

          <div className="admin-record-list">
            {loading ? <AdminSkeleton rows={6} /> : null}
            {!loading && filteredSuppliers.length === 0 ? (
              <AdminEmptyState
                icon={inactiveCount === 0 ? '✓' : '🔍'}
                title={search ? 'No suppliers match your search' : 'No suppliers yet'}
                message={search ? 'Try a different search term.' : 'Add your first supplier to get started.'}
                tone={search ? 'neutral' : 'success'}
              />
            ) : null}
            {!loading && filteredSuppliers.map((supplier) => (
              <button
                key={supplier.id}
                type="button"
                className={[
                  'admin-record-list__item',
                  selectedId === supplier.id ? 'admin-record-list__item--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => selectSupplier(supplier)}
              >
                <span className="admin-record-list__code">{supplier.name}</span>
                <span className="admin-record-list__meta">{supplier.preferredTrade || supplier.supplierType || '—'}</span>
                <AdminStatusBadge tone={supplier.active === false ? 'muted' : getSupplierApprovalBadge(supplier).modifier === 'pending' ? 'warning' : 'success'}>
                  {supplier.active === false ? 'Inactive' : getSupplierApprovalBadge(supplier).label}
                </AdminStatusBadge>
              </button>
            ))}
          </div>
        </aside>

        <section className="admin-split-layout__detail po-module-card admin-property-panel">
          {selectedId ? (
            <form className="admin-property-form" onSubmit={(e) => { e.preventDefault(); saveSupplier(); }}>
              <header className="admin-property-panel__header">
                <h2>{isNew ? 'New Supplier' : form.name || 'Supplier'}</h2>
                <p>Edit supplier master data and procurement defaults.</p>
              </header>

              <div className="admin-form__grid">
                <label className="dev-form__field">
                  <span className="dev-form__label">Supplier Name</span>
                  <input className="input" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Supplier Type</span>
                  <select className="input" value={form.supplierType} onChange={(e) => setForm((p) => ({ ...p, supplierType: e.target.value }))}>
                    {SUPPLIER_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Preferred Trade</span>
                  <select className="input" value={form.preferredTrade} onChange={(e) => setForm((p) => ({ ...p, preferredTrade: e.target.value }))}>
                    <option value="">—</option>
                    {tradeOptions.map((trade) => <option key={trade} value={trade}>{trade}</option>)}
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Preferred Commercial Head</span>
                  <select className="input" value={form.preferredCommercialHead} onChange={(e) => setForm((p) => ({ ...p, preferredCommercialHead: e.target.value }))}>
                    <option value="">—</option>
                    {headOptions.map((head) => <option key={head} value={head}>{head}</option>)}
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Payment Terms (days)</span>
                  <input className="input" type="number" value={form.termsDays} onChange={(e) => setForm((p) => ({ ...p, termsDays: e.target.value }))} />
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Credit Account</span>
                  <select className="input" value={form.creditAccount ? 'yes' : 'no'} onChange={(e) => setForm((p) => ({ ...p, creditAccount: e.target.value === 'yes' }))}>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">CIS Status</span>
                  <select className="input" value={form.cisStatus} onChange={(e) => setForm((p) => ({ ...p, cisStatus: e.target.value }))}>
                    <option value="">—</option>
                    <option value="Gross">Gross</option>
                    <option value="Standard">Standard</option>
                    <option value="Higher Rate">Higher Rate</option>
                    <option value="Not Applicable">Not Applicable</option>
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Insurance Expiry</span>
                  <input className="input" type="date" value={form.insuranceExpiry} onChange={(e) => setForm((p) => ({ ...p, insuranceExpiry: e.target.value }))} />
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Approved Supplier</span>
                  <select className="input" value={form.approvedSupplier ? 'yes' : 'no'} onChange={(e) => setForm((p) => ({ ...p, approvedSupplier: e.target.value === 'yes' }))}>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Default VAT</span>
                  <select className="input" value={form.defaultVat} onChange={(e) => setForm((p) => ({ ...p, defaultVat: e.target.value }))}>
                    <option value="Standard">Standard</option>
                    <option value="Zero Rated">Zero Rated</option>
                    <option value="Reverse Charge">Reverse Charge</option>
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">VAT Status</span>
                  <select className="input" value={form.vatStatus} onChange={(e) => setForm((p) => ({ ...p, vatStatus: e.target.value }))}>
                    <option value="VAT Registered">VAT Registered</option>
                    <option value="Not VAT Registered">Not VAT Registered</option>
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Active</span>
                  <select className="input" value={form.active ? 'yes' : 'no'} onChange={(e) => setForm((p) => ({ ...p, active: e.target.value === 'yes' }))}>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label className="dev-form__field admin-form__field--wide">
                  <span className="dev-form__label">Notes</span>
                  <textarea className="input" rows={4} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Bank Details</span>
                  <input className="input" disabled placeholder="Future module" />
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Credit Limit</span>
                  <input className="input" disabled placeholder="Future module" />
                </label>
              </div>

              <div className="admin-form__actions">
                {!isNew && selectedId && !isSupplierApproved(form) ? (
                  <AdminButton variant="primary" loading={saving} onClick={handleApproveSupplier}>
                    Approve Supplier
                  </AdminButton>
                ) : null}
                <AdminButton type="submit" variant="primary" loading={saving}>Save Supplier</AdminButton>
                <AdminButton variant="secondary" onClick={() => { setSelectedId(null); setIsNew(false); }}>Close</AdminButton>
              </div>

              {!isNew && Array.isArray(suppliers.find((item) => item.id === selectedId)?.approvalHistory)
                && suppliers.find((item) => item.id === selectedId)?.approvalHistory?.length ? (
                <section className="admin-supplier-history po-module-card">
                  <h3 className="admin-panel__title">Approval history</h3>
                  <ul className="admin-supplier-history__list">
                    {suppliers.find((item) => item.id === selectedId).approvalHistory.map((entry, index) => (
                      <li key={`${entry.at}-${index}`}>
                        <strong>{formatSupplierApprovalAction(entry.action)}</strong>
                        <span>{entry.by || 'System'}</span>
                        <span>{entry.at ? new Date(entry.at).toLocaleString('en-GB') : '—'}</span>
                        {entry.note ? <p>{entry.note}</p> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </form>
          ) : (
            <AdminEmptyState
              icon="🤝"
              title="Select a supplier"
              message="Choose a supplier from the list or add a new record to edit details."
            />
          )}
        </section>
      </div>
    </AdminPageShell>
  );
}
