// client/src/components/CostCodeSelect.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { listCostCodes } from '../api';

export default function CostCodeSelect({
  value,
  onChange,
  showLabel = true,
}) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await listCostCodes('');
        setCodes(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error('cost-codes GET failed:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return codes;
    return codes.filter((c) => {
      const code = String(c.code || c.CostCode || '').toLowerCase();
      const label =
        String(
          c.label ||
          c.description ||
          c.Element ||
          c.element ||
          ''
        ).toLowerCase();
      return code.includes(f) || label.includes(f);
    });
  }, [codes, filter]);

  const handleSelect = (e) => {
    const code = e.target.value || '';
    if (!code) {
      onChange?.('');
      return;
    }
    const full = filtered.find(
      (c) => String(c.code || c.CostCode) === code
    );
    // pass just the code string (as before), plus full if caller wants it
    onChange?.(code, full);
  };

  if (loading) {
    return (
      <div className="field">
        {showLabel && <label>Cost Code</label>}
        <select disabled>
          <option>Loading…</option>
        </select>
      </div>
    );
  }

  return (
    <div className="field">
      {showLabel && <label>Cost Code</label>}
      <input
        type="text"
        placeholder="Search code, trade, element…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 4 }}
      />
      <select value={value || ''} onChange={handleSelect}>
        <option value="">Select cost code…</option>
        {filtered.slice(0, 200).map((c, idx) => {
          const code = String(c.code || c.CostCode || '');
          const label =
            c.label ||
            c.description ||
            c.Element ||
            c.element ||
            '';
          return (
            <option key={code || idx} value={code}>
              {code} — {label}
            </option>
          );
        })}
      </select>
    </div>
  );
}
