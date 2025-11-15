// client/src/components/SupplierSelect.jsx
import React, { useEffect, useMemo, useState } from 'react';

// IMPORTANT: matches routes in poRoutes.js -> /api/po/suppliers
const API = '/api/po/suppliers';

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

  // Load suppliers
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(API);
        if (!res.ok) throw new Error('Failed to load suppliers');
        const data = await res.json();
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

  const saveSupplier = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          errBody.message || 'Failed to save supplier'
        );
      }

      const saved = await res.json();

      setSuppliers((prev) => [saved, ...prev]);
      selectAndEmit(saved);

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
    } catch (err) {
      alert(err.message);
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
          onMouseDown={() => setShowModal(false)}
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
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                />
              </label>
              <label>
                VAT No.
                <input
                  value={form.vatNumber}
                  onChange={(e) =>
                    setForm({ ...form, vatNumber: e.target.value })
                  }
                />
              </label>

              <label>
                Address 1
                <input
                  value={form.address1}
                  onChange={(e) =>
                    setForm({ ...form, address1: e.target.value })
                  }
                />
              </label>
              <label>
                Address 2
                <input
                  value={form.address2}
                  onChange={(e) =>
                    setForm({ ...form, address2: e.target.value })
                  }
                />
              </label>

              <label>
                City/Town
                <input
                  value={form.city}
                  onChange={(e) =>
                    setForm({ ...form, city: e.target.value })
                  }
                />
              </label>
              <label>
                Postcode
                <input
                  value={form.postcode}
                  onChange={(e) =>
                    setForm({ ...form, postcode: e.target.value })
                  }
                />
              </label>

              <label>
                Contact Name
                <input
                  value={form.contactName}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      contactName: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Contact Email
                <input
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      contactEmail: e.target.value,
                    })
                  }
                />
              </label>

              <label>
                Contact Phone
                <input
                  value={form.contactPhone}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      contactPhone: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Terms (days)
                <input
                  type="number"
                  min="0"
                  value={form.termsDays}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      termsDays: e.target.value,
                    })
                  }
                />
              </label>

              <label style={{ gridColumn: '1 / -1' }}>
                Notes
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) =>
                    setForm({ ...form, notes: e.target.value })
                  }
                />
              </label>

              <div
                className="modal-actions"
                style={{ gridColumn: '1 / -1' }}
              >
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
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
