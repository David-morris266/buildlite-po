import { useEffect, useMemo, useRef, useState } from 'react';
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
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef(null);

  const normalised = useMemo(
    () =>
      (options || [])
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
        .filter(Boolean),
    [options]
  );

  const filtered = useMemo(
    () => filterCostCodeSearchOptions(normalised, query, value),
    [normalised, query, value]
  );

  const selected = useMemo(
    () => normalised.find((row) => row.code === value) || null,
    [normalised, value]
  );

  useEffect(() => {
    const onDocMouseDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) {
        setOpen(false);
        setActiveIdx(-1);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  function selectCode(code) {
    const next = String(code || '').trim();
    onChange?.(next);
    setQuery('');
    setOpen(false);
    setActiveIdx(-1);
  }

  function onKeyDown(event) {
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIdx(-1);
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
      <input
        className="input"
        type="text"
        value={query}
        disabled={disabled}
        placeholder="Search code or description"
        aria-label={`${name} cost code search`}
        aria-expanded={open}
        aria-controls={`${name}-cost-code-list`}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onKeyDown={onKeyDown}
      />
      <p
        className={
          selected
            ? 'dev-prelims-setup__cost-code-selected'
            : 'dev-prelims-setup__cost-code-selected dev-prelims-setup__cost-code-selected--empty'
        }
        aria-label={`${name} cost code`}
        data-cost-code={value || ''}
      >
        {selected ? mappingOptionPrimaryLabel(selected) : 'Select cost code'}
      </p>
      {open && !disabled ? (
        <div
          className="dev-prelims-setup__cost-code-menu"
          id={`${name}-cost-code-list`}
          role="listbox"
          aria-label={`${name} cost code options`}
        >
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
        </div>
      ) : null}
    </div>
  );
}
