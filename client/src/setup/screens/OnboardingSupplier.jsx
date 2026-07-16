import { SETUP_FORM_IDS } from '../constants';

export default function OnboardingSupplier({ value, onChange, errors, onSubmit }) {
  return (
    <section className="setup-step">
      <h1 className="setup-step__title">First Supplier</h1>
      <p className="setup-step__lead">Add your first supplier. You can add more detail later in Administration.</p>

      <form id={SETUP_FORM_IDS.supplier} className="setup-form" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
        <div className="setup-form__grid">
          <label className="dev-form__field">
            <span className="dev-form__label">Supplier Name</span>
            <input className="input" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
            {errors.name ? <span className="setup-step__error">{errors.name}</span> : null}
          </label>
          <label className="dev-form__field admin-form__field--wide">
            <span className="dev-form__label">Address Line 1</span>
            <input className="input" value={value.addressLine1} onChange={(e) => onChange({ ...value, addressLine1: e.target.value })} />
          </label>
          <label className="dev-form__field admin-form__field--wide">
            <span className="dev-form__label">Address Line 2</span>
            <input className="input" value={value.addressLine2} onChange={(e) => onChange({ ...value, addressLine2: e.target.value })} />
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Town / City</span>
            <input className="input" value={value.town} onChange={(e) => onChange({ ...value, town: e.target.value })} />
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Postcode</span>
            <input className="input" value={value.postcode} onChange={(e) => onChange({ ...value, postcode: e.target.value })} />
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">VAT Number</span>
            <input className="input" value={value.vatNumber} onChange={(e) => onChange({ ...value, vatNumber: e.target.value })} />
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Payment Terms (days)</span>
            <input className="input" type="number" value={value.termsDays} onChange={(e) => onChange({ ...value, termsDays: e.target.value })} />
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Preferred Trade</span>
            <input className="input" value={value.preferredTrade} onChange={(e) => onChange({ ...value, preferredTrade: e.target.value })} />
          </label>
        </div>
      </form>
    </section>
  );
}
