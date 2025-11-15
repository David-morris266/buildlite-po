// client/src/components/SupplierSelect.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { listSuppliers, createSupplier } from '../api';

/**
 * SupplierSelect
 * Props:
 * - value: supplier id (string) OR object { id, name, ... }
 * - onChange: called with { id, name } OR null
 * - onSelectFull: (optional) full supplier object on select/create
 * - showLabel: show the internal <label> (default true).
 */
export default function SupplierSelect({
  value,
  onChange,
  onSelectFull,
  showLabel = true,
}) {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // New-supplier form state
  const [form, setForm] = useState({
    name: '',
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
  });

  // Normalise current value to an id
  const currentId = useMemo(() => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      return value.id || value?.supplierId || '';
    }
    return '';
  }, [value]);

  // Load suppliers from API helper
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

  const selectAndEmit = (sup) => {
    if (sup) {
      onChange?.({ id: sup.id, name: sup.name });
      onSelectFull?.(sup);
    } else {
      onChange?.(null);
    }
  };

  const handleSelect = (e) => {
    const id = e.target.value;
    if (id === '__new__') {
      setShowModal(true);
      return;
    }
    const full =
      suppliers.find((s) => String(s.id) === String(id)) || null;
    selectAndEmit(full);
  };

  const handleChangeField = (field) => (e) => {
    const value =
      field === 'termsDays' ? Number(e.target.value || 0) : e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const closeModal = () => {
    setShowModal(false);
    setForm({
      name: '',
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
    });
  };

  const saveSupplier = async (e) => {
    e.preventDefault();
    try {
      const saved = await createSupplier(form);

      // Add to list and select it
      setSuppliers((prev) => [saved, ...prev]);
      selectAndEmit(saved);

      closeModal();
    } catch (err) {
      console.error('createSupplier failed:', err);
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

  return (
    <div className="field">
      {showLabel && <label>Supplier</label>}
      <select value={currentId} onChange={handleSelect}>
        <option value="">Select supplier…</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
        <option value="__new__">➕ Add new supplier…</option>
      </select>

      {showModal && (
        <div
          className="modal-backdrop"
          onMouseDown={closeModal}
        >
          <div
            className="modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3>New Supplier</h3>
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
                VAT No.
                <input
                  value={form.vatNumber}
                  onChange={handleChangeField('vatNumber')}
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
                <input
                  value={form.city}
                  onChange={handleChangeField('city')}
                />
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
              <label>
                Terms (days)
                <input
                  type="number"
                  min="0"
                  value={form.termsDays}
                  onChange={handleChangeField('termsDays')}
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

              <div
                className="modal-actions"
                style={{ gridColumn: '1 / -1' }}
              >
                <button
                  type="button"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button type="submit">Save Supplier</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
