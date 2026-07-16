import { SETUP_FORM_IDS } from '../constants';

const PREFIX_FIELDS = [
  ['development', 'Development'],
  ['purchaseOrder', 'Purchase Order'],
  ['paymentCertificate', 'Payment Certificate'],
  ['cvr', 'CVR'],
  ['variationOrder', 'Variation Order'],
  ['salesPlot', 'Sales Plot'],
];

export default function OnboardingCommercial({ value, onChange, errors, onSubmit }) {
  function updatePrefix(key, prefixValue) {
    onChange({
      ...value,
      numberingPrefixes: { ...value.numberingPrefixes, [key]: prefixValue },
    });
  }

  return (
    <section className="setup-step">
      <h1 className="setup-step__title">Commercial Defaults</h1>
      <p className="setup-step__lead">Set financial defaults and numbering rules used across BuildLite.</p>

      <form id={SETUP_FORM_IDS.commercial} className="setup-form" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
        <div className="setup-form__grid">
          <label className="dev-form__field">
            <span className="dev-form__label">Default Retention (%)</span>
            <input className="input" type="number" value={value.defaultRetentionPercent} onChange={(e) => onChange({ ...value, defaultRetentionPercent: e.target.value })} />
            {errors.defaultRetentionPercent ? <span className="setup-step__error">{errors.defaultRetentionPercent}</span> : null}
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">VAT (%)</span>
            <input className="input" type="number" value={value.vatRate} onChange={(e) => onChange({ ...value, vatRate: e.target.value })} />
            {errors.vatRate ? <span className="setup-step__error">{errors.vatRate}</span> : null}
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Forecast Behaviour</span>
            <select className="input" value={value.defaultForecastBehaviour} onChange={(e) => onChange({ ...value, defaultForecastBehaviour: e.target.value })}>
              <option value="Committed">Committed</option>
              <option value="Budget">Budget</option>
              <option value="Actual">Actual</option>
            </select>
          </label>
        </div>

        <h2 className="setup-form__subtitle">Numbering Prefixes</h2>
        <div className="setup-form__grid">
          {PREFIX_FIELDS.map(([key, label]) => (
            <label key={key} className="dev-form__field">
              <span className="dev-form__label">{label}</span>
              <input className="input" value={value.numberingPrefixes?.[key] || ''} onChange={(e) => updatePrefix(key, e.target.value)} />
            </label>
          ))}
        </div>
      </form>
    </section>
  );
}
