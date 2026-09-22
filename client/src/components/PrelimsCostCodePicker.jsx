import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  filterCostCodeSearchOptions,
  mappingOptionPrimaryLabel,
  mappingOptionSecondaryLabel,
} from '../admin/prelimsTemplateMapping';

/**
 * Searchable cost-code picker for Prelims setup.
 * Persists canonical code only. Description is primary; reporting group is secondary.
 */
export default function PrelimsCostCodePicker({
  options = [],
  value = '',
  onChange,
  disabled = false,
  name = 'Cost code',
  allowClear = false,
  retainSelectedInSearch = true,
  contextKey = '',
  allOptions = null,
  scopeLabel = '',
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [scope, setScope] = useState('suggested');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState(null);

  const normalise = (rows) =>
      (rows || [])
        .map((row) => {
          const code = String(row.code || row.value || row.costCodeKey || '').trim();
          if (!code) return null;
          return {
            ...row,
            code,
            description: row.description || row.element || '',
            reportingGroup: row.reportingGroup || row.trade || '',
          };
        })
        .filter(Boolean);

  const suggested = useMemo(() => normalise(options), [options]);
  const all = useMemo(() => normalise(allOptions == null ? options : allOptions), [allOptions, options]);
  const normalised = scope === 'all' ? all : suggested;

  const filtered = useMemo(
    () => filterCostCodeSearchOptions(normalised, query, retainSelectedInSearch ? value : ''),
    [normalised, query, retainSelectedInSearch, value]
  );

  const selected = useMemo(
    () => all.find((row) => row.code === value) || null,
    [all, value]
  );

  useEffect(() => {
    const onDocMouseDown = (event) => {
      if (!wrapRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery('');
        setActiveIdx(-1);
        setScope('suggested');
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  useEffect(() => {
    setOpen(false);
    setQuery('');
    setActiveIdx(-1);
    setScope('suggested');
  }, [contextKey]);

  const positionMenu = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const gap = 4;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const below = Math.max(0, viewportHeight - rect.bottom - gap - margin);
    const above = Math.max(0, rect.top - gap - margin);
    const placeAbove = below < 220 && above > below;
    const available = placeAbove ? above : below;
    const maxHeight = Math.min(320, available);
    const width = Math.min(Math.max(rect.width, 260), Math.max(0, viewportWidth - margin * 2));
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, viewportWidth - width - margin));
    setMenuStyle({ left, top: placeAbove ? Math.max(margin, rect.top - gap - maxHeight) : rect.bottom + gap, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    positionMenu();
    const reposition = () => positionMenu();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(reposition)
      : null;
    if (inputRef.current) resizeObserver?.observe(inputRef.current);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
      resizeObserver?.disconnect();
    };
  }, [open, positionMenu]);

  function selectCode(code) {
    const next = String(code || '').trim();
    onChange?.(next);
    setQuery('');
    setOpen(false);
    setActiveIdx(-1);
    setScope('suggested');
  }

  function onKeyDown(event) {
    if (!open && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      setQuery('');
      setOpen(true);
      return;
    }
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
      setActiveIdx(-1);
      setScope('suggested');
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIdx((idx) => Math.min(idx + 1, filtered.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIdx((idx) => Math.max(idx - 1, 0));
      return;
    }
    if (event.key === 'Enter' && open && activeIdx >= 0 && filtered[activeIdx]) {
      event.preventDefault();
      selectCode(filtered[activeIdx].code);
    }
  }

  return (
    <div className="dev-prelims-setup__cost-code-picker" ref={wrapRef}>
      <div className="dev-prelims-setup__cost-code-combobox">
        <input
          ref={inputRef}
          className="input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          value={open ? query : selected ? mappingOptionPrimaryLabel(selected) : ''}
          data-cost-code={value || ''}
          disabled={disabled}
          placeholder={open ? `Search ${scope === 'all' ? 'all' : scopeLabel || ''} Cost Codes...` : 'Select Cost Code...'}
          aria-label={`${name} cost code search`}
          aria-expanded={open}
          aria-controls={`${name}-cost-code-list`}
          autoComplete="off"
          onFocus={() => { setQuery(''); setOpen(true); setActiveIdx(-1); }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="dev-prelims-setup__cost-code-toggle" aria-label={`Open ${name} Cost Code`} disabled={disabled} onClick={() => { inputRef.current?.focus(); setQuery(''); setOpen(true); }}>
          <span aria-hidden="true">▾</span>
        </button>
      </div>
      {open && !disabled && menuStyle ? createPortal(
        <div
          ref={menuRef}
          className="dev-prelims-setup__cost-code-menu dev-prelims-setup__cost-code-menu--portal"
          id={`${name}-cost-code-list`}
          role="listbox"
          aria-label={`${name} cost code options`}
          style={menuStyle}
        >
          <>
            {scopeLabel ? <div className="dev-prelims-setup__cost-code-scope">{scope === 'all' ? 'Searching all Cost Codes' : scopeLabel}</div> : null}
            {allowClear && selected ? (
              <button
                type="button"
                role="option"
                aria-selected="false"
                data-cost-code=""
                className="dev-prelims-setup__cost-code-option"
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectCode('');
                }}
              >
                <span className="dev-prelims-setup__cost-code-primary">Clear mapping</span>
                <span className="dev-prelims-setup__cost-code-secondary">Set destination to Unmapped</span>
              </button>
            ) : null}
            {filtered.length === 0 ? (
              <div className="dev-prelims-setup__cost-code-empty">No matches</div>
            ) : (
              filtered.map((option, idx) => {
                const secondary = mappingOptionSecondaryLabel(option);
                return (
                <button
                  key={option.code}
                  type="button"
                  role="option"
                  aria-selected={option.code === value}
                  data-cost-code={option.code}
                  className={
                    idx === activeIdx
                      ? 'dev-prelims-setup__cost-code-option is-active'
                      : 'dev-prelims-setup__cost-code-option'
                  }
                  onMouseEnter={() => setActiveIdx(idx)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectCode(option.code);
                  }}
                >
                  <span className="dev-prelims-setup__cost-code-primary">
                    {mappingOptionPrimaryLabel(option)}
                  </span>
                  {secondary ? (
                    <span className="dev-prelims-setup__cost-code-secondary">{secondary}</span>
                  ) : null}
                </button>
                );
              })
            )}
            {allOptions != null ? <button type="button" className="dev-prelims-setup__cost-code-scope-action" onMouseDown={(event) => { event.preventDefault(); setScope(scope === 'all' ? 'suggested' : 'all'); setQuery(''); setActiveIdx(-1); inputRef.current?.focus(); }}>
              {scope === 'all' ? `Back to ${scopeLabel || 'suggested Cost Codes'}` : 'Show all Cost Codes'}
            </button> : null}
          </>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
