import { useEffect } from 'react';
import { generateNextDevelopmentNumber } from '../../admin/numberingService';
import { SETUP_FORM_IDS } from '../constants';
import {
  listSetupClientOptions,
  resolveSetupClientDefault,
  shouldUseSetupClientDropdown,
} from '../setupClientDefaults';

export default function OnboardingDevelopment({
  value,
  onChange,
  errors,
  onSubmit,
  company,
}) {
  const useClientDropdown = shouldUseSetupClientDropdown();
  const clientOptions = listSetupClientOptions(company);

  useEffect(() => {
    const patch = {};

    if (!String(value.developmentCode || '').trim()) {
      patch.developmentCode = generateNextDevelopmentNumber();
    }

    if (!String(value.client || '').trim()) {
      const defaultClient = resolveSetupClientDefault(company);
      if (defaultClient) patch.client = defaultClient;
    }

    if (Object.keys(patch).length) {
      onChange({ ...value, ...patch });
    }
  }, []);

  return (
    <section className="setup-step">
      <h1 className="setup-step__title">First Development</h1>
      <p className="setup-step__lead">Create your first development so you have somewhere to begin in BuildLite.</p>

      <form id={SETUP_FORM_IDS.development} className="setup-form" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
        <div className="setup-form__grid">
          <label className="dev-form__field">
            <span className="dev-form__label">Development Name</span>
            <input
              className="input"
              value={value.developmentName}
              placeholder="Oakwood Meadows"
              onChange={(e) => onChange({ ...value, developmentName: e.target.value })}
            />
            <span className="setup-step__hint">Example: Oakwood Meadows</span>
            {errors.developmentName ? <span className="setup-step__error">{errors.developmentName}</span> : null}
          </label>

          <label className="dev-form__field">
            <span className="dev-form__label">Development Code</span>
            <input
              className="input"
              value={value.developmentCode}
              onChange={(e) => onChange({ ...value, developmentCode: e.target.value })}
            />
            <span className="setup-step__hint">Generated automatically using Company Settings.</span>
          </label>

          <label className="dev-form__field">
            <span className="dev-form__label">Client</span>
            {useClientDropdown ? (
              <select
                className="input"
                value={value.client}
                onChange={(e) => onChange({ ...value, client: e.target.value })}
              >
                <option value="">Select client (optional)</option>
                {clientOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                value={value.client}
                onChange={(e) => onChange({ ...value, client: e.target.value })}
              />
            )}
            <span className="setup-step__hint">Defaults to your own company. Can be changed later.</span>
          </label>

          <label className="dev-form__field">
            <span className="dev-form__label">Target Start</span>
            <input className="input" type="date" value={value.targetStart} onChange={(e) => onChange({ ...value, targetStart: e.target.value })} />
          </label>

          <label className="dev-form__field">
            <span className="dev-form__label">Target Completion</span>
            <input className="input" type="date" value={value.targetCompletion} onChange={(e) => onChange({ ...value, targetCompletion: e.target.value })} />
          </label>
        </div>
      </form>
    </section>
  );
}
