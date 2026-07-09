// client/src/components/SupplierSelect.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { listSuppliers, createSupplier, updateSupplier } from '../api';
import {
  SUPPLIER_TYPES,
  getSuggestedOrderTypeForSupplier,
  getSupplierTypeMeta,
} from '../suppliers/supplierTypes';

const EMPTY_FORM = {
  name: '',
  supplierType: 'subcontractor',
  address1: '',
  address2: '',
  city: '',
  postcode: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  vatNumber: '',
  termsDays: 30,
  notes: '',
};

/**
 * SupplierSelect
 * Props:
 * - value: supplier id (string) OR object { id, name, ... }
 * - onChange: called with { id, name } OR null
 * - onSelectFull: (optional) full supplier object on select/create
 * - onSuggestedOrderType: (optional) suggested PO order type (M/S/P)
 * - showLabel: show the internal <label> (default true).
 */
export default function SupplierSelect({
  value,
  onChange,
  onSelectFull,
  onSuggestedOrderType,
  showLabel = true,
}) {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const currentId = useMemo(() => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      return value.id || value?.supplierId || '';
    }
    return '';
  }, [value]);

  const selectedSupplier = useMemo(
    () => suppliers.find((item) => String(item.id) === String(currentId)) || null,
    [suppliers, currentId]
  );

  const selectAndEmit = (sup) => {
    if (sup) {
      onChange?.({ id: sup.id, name: sup.name });
      onSelectFull?.(sup);
      onSuggestedOrderType?.(getSuggestedOrderTypeForSupplier(sup));
    } else {
      onChange?.(null);
      onSelectFull?.(null);
      onSuggestedOrderType?.(null);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await listSuppliers('');
        setSuppliers(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error('suppliers GET failed:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSelect = (e) => {
    const id = e.target.value;
    if (id === '__new__') {
      setEditingSupplier(null);
      setForm(EMPTY_FORM);
      setShowModal(true);
      return;
    }
    if (id === '__edit__') {
      if (!selectedSupplier) return;
      setEditingSupplier(selectedSupplier);
      setForm({
        name: selectedSupplier.name || '',
        supplierType: selectedSupplier.supplierType || 'other',
        address1: selectedSupplier.address1 || '',
        address2: selectedSupplier.address2 || '',
        city: selectedSupplier.city || '',
        postcode: selectedSupplier.postcode || '',
        contactName: selectedSupplier.contactName || '',
        contactEmail: selectedSupplier.contactEmail || '',
        contactPhone: selectedSupplier.contactPhone || '',
        vatNumber: selectedSupplier.vatNumber || '',
        termsDays: selectedSupplier.termsDays ?? 30,
        notes: selectedSupplier.notes || '',
      });
      setShowModal(true);
      return;
    }
    const full = suppliers.find((s) => String(s.id) === String(id)) || null;
    selectAndEmit(full);
  };

  const handleChangeField = (field) => (e) => {
    const nextValue =
      field === 'termsDays' ? Number(e.target.value || 0) : e.target.value;
    setForm((prev) => ({ ...prev, [field]: nextValue }));
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingSupplier(null);
    setForm(EMPTY_FORM);
  };

  const saveSupplier = async (e) => {
    e.preventDefault();
    try {
      const saved = editingSupplier
        ? await updateSupplier(editingSupplier.id, form)
        : await createSupplier(form);

      setSuppliers((prev) => {
        const next = prev.filter((item) => String(item.id) !== String(saved.id));
        return [saved, ...next];
      });
      selectAndEmit(saved);
      closeModal();
    } catch (err) {
      console.error('saveSupplier failed:', err);
      alert(err.message || 'Failed to save supplier');
    }
  };

  if (loading) {
    return (
      <div className="field">
        {showLabel && <label>Supplier</label>}
        <select disabled>
          <option>Loading…</option>
        </select>
      </div>
    );
  }

  const supplierTypeLabel = selectedSupplier
    ? getSupplierTypeMeta(selectedSupplier.supplierType)?.label || 'Other'
    : null;

  return (
    <div className="field">
      {showLabel && <label>Supplier</label>}
      <select value={currentId} onChange={handleSelect}>
        <option value="">Select supplier…</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.supplierType
              ? ` · ${getSupplierTypeMeta(s.supplierType)?.label || 'Other'}`
              : ''}
          </option>
        ))}
        <option value="__new__">➕ Add new supplier…</option>
        {selectedSupplier ? (
          <option value="__edit__">✎ Edit selected supplier…</option>
        ) : null}
      </select>
      {supplierTypeLabel ? (
        <p className="po-field__hint">Supplier type: {supplierTypeLabel}</p>
      ) : null}
      {!loading && suppliers.length === 0 ? (
        <p className="po-field__hint">No suppliers yet.</p>
      ) : null}

      {showModal && (
        <div className="modal-backdrop" onMouseDown={closeModal}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>{editingSupplier ? 'Edit Supplier' : 'New Supplier'}</h3>
            <form className="grid2" onSubmit={saveSupplier}>
              <label>
                Name
                <input
                  required
                  value={form.name}
                  onChange={handleChangeField('name')}
                />
              </label>
              <label>
                Supplier Type
                <select
                  value={form.supplierType}
                  onChange={handleChangeField('supplierType')}
                >
                  {SUPPLIER_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                VAT No.
                <input
                  value={form.vatNumber}
                  onChange={handleChangeField('vatNumber')}
                />
              </label>
              <label>
                Terms (days)
                <input
                  type="number"
                  min="0"
                  value={form.termsDays}
                  onChange={handleChangeField('termsDays')}
                />
              </label>

              <label>
                Address 1
                <input
                  value={form.address1}
                  onChange={handleChangeField('address1')}
                />
              </label>
              <label>
                Address 2
                <input
                  value={form.address2}
                  onChange={handleChangeField('address2')}
                />
              </label>

              <label>
                City/Town
                <input value={form.city} onChange={handleChangeField('city')} />
              </label>
              <label>
                Postcode
                <input
                  value={form.postcode}
                  onChange={handleChangeField('postcode')}
                />
              </label>

              <label>
                Contact Name
                <input
                  value={form.contactName}
                  onChange={handleChangeField('contactName')}
                />
              </label>
              <label>
                Contact Email
                <input
                  type="email"
                  value={form.contactEmail}
                  onChange={handleChangeField('contactEmail')}
                />
              </label>

              <label>
                Contact Phone
                <input
                  value={form.contactPhone}
                  onChange={handleChangeField('contactPhone')}
                />
              </label>

              <label style={{ gridColumn: '1 / -1' }}>
                Notes
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={handleChangeField('notes')}
                />
              </label>

              <div className="modal-actions" style={{ gridColumn: '1 / -1' }}>
                <button type="button" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit">
                  {editingSupplier ? 'Save Changes' : 'Save Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
