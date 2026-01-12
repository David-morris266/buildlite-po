// client/src/components/CostCodeSelect.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { listCostCodes } from '../api';

/**
 * CostCodeSelect (autocomplete)
 * Stores FULL LABEL as the value.
 *
 * Props:
 *  - value: string (full label) e.g. "1190 — Consultant — Archaeology"
 *  - onChange: (fullLabel, fullObj) => void
 *  - showLabel: boolean
 */
export default function CostCodeSelect({ value, onChange, showLabel = true }) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Keep input text in sync if parent changes value externally
  useEffect(() => {
    setQuery(value || '');
  }, [value]);

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

  // Normalise each row to a consistent shape
  const normalised = useMemo(() => {
    return (codes || [])
      .map((c) => {
        const code = String(c.code ?? c['Cost Code'] ?? c.CostCode ?? '').trim();
        const subHeading = String(c.subHeading ?? c['Sub-Heading'] ?? c['Sub Heading'] ?? '').trim();
        const trade = String(c.trade ?? c.Trade ?? '').trim();
        const element = String(c.element ?? c.Element ?? '').trim();

        // If your JSON already has label, use it; else build it.
        const label =
          String(c.label ?? '').trim() ||
          [code, trade, element].filter(Boolean).join(' — ');

        return { raw: c, code, subHeading, trade, element, label };
      })
      // drop header-ish row + blanks
      .filter((x) => x.code && x.code.toLowerCase() !== 'cost code');
  }, [codes]);

  const filtered = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return normalised.slice(0, 25);

    const res = normalised.filter((x) => {
      const hay = [
        x.code,
        x.subHeading,
        x.trade,
        x.element,
        x.label,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return hay.includes(q);
    });

    return res.slice(0, 25);
  }, [normalised, query]);

  const selectItem = (item) => {
    const fullLabel = item?.label || '';
    setQuery(fullLabel);
    setOpen(false);
    setActiveIdx(-1);
    onChange?.(fullLabel, item?.raw || item);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const onDocMouseDown = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) {
        setOpen(false);
        setActiveIdx(-1);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }

    if (e.key === 'Escape') {
      setOpen(false);
      setActiveIdx(-1);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      if (open && activeIdx >= 0 && filtered[activeIdx]) {
        e.preventDefault();
        selectItem(filtered[activeIdx]);
      } else {
        // prevent PO form submitting when you press Enter inside search
        e.preventDefault();
      }
    }
  };

  return (
    <div className="field" ref={wrapRef} style={{ position: 'relative' }}>
      {showLabel && <label>Cost Code</label>}

      <input
        ref={inputRef}
        type="text"
        placeholder={loading ? 'Loading cost codes…' : 'Search code, trade, element…'}
        value={query}
        disabled={loading}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIdx(-1);
          // If they start typing again, clear stored value upstream
          // (optional but usually desired)
          onChange?.('', null);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />

      {open && !loading && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 'calc(100% + 6px)',
            zIndex: 50,
            borderRadius: 10,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(0,0,0,0.92)',
            boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: 10, opacity: 0.75, fontSize: 13 }}>
              No matches
            </div>
          ) : (
            filtered.map((item, idx) => {
              const active = idx === activeIdx;
              return (
                <div
                  key={`${item.code}-${idx}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onMouseDown={(e) => {
                    // mouseDown so it selects before input blur
                    e.preventDefault();
                    selectItem(item);
                  }}
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    fontSize: 13,
                    lineHeight: 1.25,
                    background: active ? 'rgba(120,255,120,0.14)' : 'transparent',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{item.label}</div>
                  <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>
                    {item.subHeading ? `${item.subHeading} • ` : ''}
                    {item.code}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
