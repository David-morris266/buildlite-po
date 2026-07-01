import { useMemo } from 'react';
import {
  formatDevelopmentSelectorOption,
  UNKNOWN_DEVELOPMENT_LABEL,
} from '../developments/developmentPoHelpers';
import { listDevelopments } from '../developments/developmentStore';

export default function DevelopmentSelect({
  value,
  onChange,
  disabled = false,
  showLabel = true,
}) {
  const developments = useMemo(() => listDevelopments(), []);

  const options = useMemo(
    () => developments.map(formatDevelopmentSelectorOption),
    [developments]
  );

  if (!developments.length) {
    return (
      <div className="dev-po-select dev-po-select--empty">
        {showLabel ? <span className="dev-form__label">Development</span> : null}
        <p className="dev-po-select__empty-message">{UNKNOWN_DEVELOPMENT_LABEL}</p>
      </div>
    );
  }

  return (
    <div className="dev-po-select">
      {showLabel ? <span className="dev-form__label">Development *</span> : null}
      <select
        className="select dev-po-select__input"
        value={value || ''}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value || null)}
        aria-label="Select development"
      >
        <option value="">Choose a development…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.display} — {option.statusLabel}
          </option>
        ))}
      </select>

      {value ? (
        <div className="dev-po-select__selected" aria-live="polite">
          {options
            .filter((option) => option.id === value)
            .map((option) => (
              <span
                key={option.id}
                className={`po-status-badge po-status-badge--${option.statusModifier}`}
              >
                {option.statusLabel}
              </span>
            ))}
        </div>
      ) : null}
    </div>
  );
}

export function DevelopmentSelectEmptyState({ onCreateDevelopment }) {
  return (
    <div className="po-module-card po-empty-state dev-po-empty">
      <p className="po-empty-state__message">
        No Developments have been created.
      </p>
      <p className="po-empty-state__hint">
        Create a Development before raising your first Purchase Order.
      </p>
      <button
        type="button"
        className="po-btn-primary"
        onClick={onCreateDevelopment}
      >
        Create Development
      </button>
    </div>
  );
}

export function useDevelopmentRecord(developmentId) {
  return useMemo(() => {
    if (!developmentId) return null;
    return listDevelopments().find((item) => item.id === developmentId) || null;
  }, [developmentId]);
}
