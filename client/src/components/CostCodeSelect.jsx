// client/src/components/CostCodeSelect.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';

const API = 'http://localhost:3001/api/po/cost-codes';

function normStr(v) { return (v == null ? '' : String(v)).trim(); }
function looksLikeHeader(r) {
  const c = normStr(r.code).toLowerCase();
  const t = normStr(r.trade).toLowerCase();
  const e = normStr(r.element).toLowerCase();
  const s = normStr(r.subHeading).toLowerCase();
  if (!c && !t && !e && !s) return true;
  if (['cost code', 'code'].includes(c)) return true;
  if (t === 'trade' || e === 'element' || s === 'sub-heading') return true;
  return false;
}
function normaliseRow(row) {
  const code = normStr(row['Cost Code'] ?? row['cost code'] ?? row.Code ?? row.code);
  const trade = normStr(row.Trade ?? row.trade);
  const element = normStr(row.Element ?? row.element);
  const subHeading = normStr(row['Sub-Heading'] ?? row.SubHeading ?? row.subHeading);
  if (!code && !trade && !element && !subHeading) return null;
  const tail = [trade, element || subHeading].filter(Boolean).join(' — ');
  const label = [code, tail].filter(Boolean).join(' — ');
  const out = { code, trade, element, subHeading, label };
  return looksLikeHeader(out) ? null : out;
}

export default function CostCodeSelect({
  value,
  onChange,
  placeholder = 'Search code, trade, element…',
  maxResults = 300
}) {
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);

  // typeahead state
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  const inputRef = useRef(null);
  const listRef = useRef(null);

  // fetch once
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(API);
        const data = await res.json();
        setRaw(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error('cost-codes GET failed:', e);
        setRaw([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // normalised, deduped, sorted
  const allOptions = useMemo(() => {
    const mapped = raw.map(normaliseRow).filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const r of mapped) {
      const k = `${r.code}|${r.label}`;
      if (!seen.has(k)) { seen.add(k); out.push(r); }
    }
    out.sort((a, b) => {
      const c = a.code.localeCompare(b.code, undefined, { numeric: true });
      return c || a.label.localeCompare(b.label);
    });
    return out;
  }, [raw]);

  // current display text (when a value is already chosen)
  const currentText = useMemo(() => {
    if (!value) return '';
    if (typeof value === 'string') {
      const found = allOptions.find(o => o.code === value);
      return found ? found.label : value;
    }
    if (typeof value === 'object' && value.code) {
      return value.label || `${value.code}${value.trade || value.element || value.subHeading ? ' — ' + [value.trade, value.element || value.subHeading].filter(Boolean).join(' — ') : ''}`;
    }
    return '';
  }, [value, allOptions]);

  // filtered list
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions.slice(0, maxResults);
    const parts = q.split(/\s+/).filter(Boolean);
    const match = (o) => {
      const hay = `${o.code} ${o.trade} ${o.element} ${o.subHeading} ${o.label}`.toLowerCase();
      return parts.every(p => hay.includes(p));
    };
    return allOptions.filter(match).slice(0, maxResults);
  }, [allOptions, query, maxResults]);

  // open list when focusing if we have data
  const onFocus = () => { if (!loading) setOpen(true); };
  const pick = (opt) => {
    onChange?.(opt);
    setQuery('');
    setOpen(false);
    // keep the pretty label in the input
    if (inputRef.current) inputRef.current.value = opt.label;
  };

  // keyboard nav
  const onKeyDown = (e) => {
    if (!open && ['ArrowDown','ArrowUp'].includes(e.key)) { setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const sel = filtered[activeIdx]; if (sel) pick(sel); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  // keep active item in view
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector(`[data-active="true"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  // click outside to close
  useEffect(() => {
    const onDoc = (e) => {
      const root = inputRef.current?.closest('.ccs-root');
      if (root && !root.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="field ccs-root" style={{ position: 'relative' }}>
      <label>Cost Code</label>

      <input
        ref={inputRef}
        type="text"
        placeholder={loading ? 'Loading…' : placeholder}
        defaultValue={currentText}
        onFocus={onFocus}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIdx(0); }}
        onKeyDown={onKeyDown}
        disabled={loading}
        autoComplete="off"
      />

      {/* dropdown */}
      {open && (
        <div
          role="listbox"
          ref={listRef}
          style={{
            position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%',
            background: '#0b0f14', border: '1px solid #1f2732', borderRadius: 8,
            marginTop: 4, maxHeight: 280, overflow: 'auto', boxShadow: '0 10px 24px rgba(0,0,0,.35)'
          }}
        >
          {filtered.length === 0 && (
            <div style={{ padding: 10, color: '#94a3b8', fontSize: 13 }}>No matches</div>
          )}

          {filtered.map((o, i) => (
            <div
              key={`${o.code}|${i}`}
              role="option"
              data-active={i === activeIdx ? 'true' : undefined}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              style={{
                padding: '8px 10px',
                cursor: 'pointer',
                background: i === activeIdx ? '#111827' : 'transparent'
              }}
              title={o.label}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{o.code}</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                {[o.trade, o.element || o.subHeading].filter(Boolean).join(' — ')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
