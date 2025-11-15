// client/src/components/CostCodeSelect.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { listCostCodes } from '../api';

export default function CostCodeSelect({
  value = '',
  onChange,
  showLabel = true,
}) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  // Load cost codes once from the API (goes via API_BASE + /api/po/cost-codes)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const data = await listCostCodes(''); // server can ignore or use this later
        if (!cancelled) {
          setCodes(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        console.error('cost-codes GET failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Client-side filtering
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return codes;

    return codes.filter((c) => {
      const code = String(c.code || c.CostCode || '').toLowerCase();
      const desc = String(c.description || c.Element || '').toLowerCase();
      return code.includes(f) || desc.includes(f);
    });
  }, [codes, filter]);

  const handleSelect = (e) => {
    const code = e.target.value || '';

    if (!code) {
      onChange?.('');
      return;
    }

    const full = filtered.find(
      (c) => String(c.code || c.CostCode || '') === code
    );

    // Maintain existing behaviour: main value is the code string
    // and optionally pass back the full record as 2nd arg
    onChange?.(code, full || null);
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
          const desc = c.description || c.Element || '';
          return (
            <option key={code || idx} value={code}>
              {code} — {desc}
            </option>
          );
        })}
      </select>
    </div>
  );
}
