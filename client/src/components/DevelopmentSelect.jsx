import { useEffect, useMemo, useState } from 'react';
import {
  formatDevelopmentSelectorOption,
  UNKNOWN_DEVELOPMENT_LABEL,
} from '../developments/developmentPoHelpers';
import {
  ensureDevelopmentsReady,
  listDevelopments,
} from '../developments/developmentStore';

export default function DevelopmentSelect({
  value,
  onChange,
  disabled = false,
  showLabel = true,
}) {
  const [developments, setDevelopments] = useState([]);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    ensureDevelopmentsReady()
      .then(() => {
        if (!cancelled) {
          setDevelopments(listDevelopments());
          setLoadError('');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDevelopments([]);
          setLoadError(error.message || 'Could not load developments from the server.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(
    () => developments.map(formatDevelopmentSelectorOption),
    [developments]
  );

  if (loadError) {
    return (
      <div className="dev-po-select dev-po-select--empty">
        {showLabel ? <span className="dev-form__label">Development</span> : null}
        <p className="dev-po-select__empty-message">{loadError}</p>
      </div>
    );
  }

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
  const [record, setRecord] = useState(null);

  useEffect(() => {
    let cancelled = false;
    ensureDevelopmentsReady()
      .then(() => {
        if (!cancelled) {
          setRecord(
            developmentId
              ? listDevelopments().find((item) => item.id === developmentId) || null
              : null
          );
        }
      })
      .catch(() => {
        if (!cancelled) setRecord(null);
      });
    return () => {
      cancelled = true;
    };
  }, [developmentId]);

  return record;
}
