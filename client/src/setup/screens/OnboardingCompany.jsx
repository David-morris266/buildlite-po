import { SETUP_FORM_IDS } from '../constants';

export default function OnboardingCompany({ value, onChange, errors, onSubmit }) {
  return (
    <section className="setup-step">
      <h1 className="setup-step__title">Company Details</h1>
      <p className="setup-step__lead">Tell us about your company. These details populate Administration → Company.</p>

      <form id={SETUP_FORM_IDS.company} className="setup-form" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
        <div className="setup-form__grid">
          <label className="dev-form__field">
            <span className="dev-form__label">Company Name</span>
            <input className="input" value={value.companyName} onChange={(e) => onChange({ ...value, companyName: e.target.value })} />
            {errors.companyName ? <span className="setup-step__error">{errors.companyName}</span> : null}
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Trading Name</span>
            <input className="input" value={value.tradingName} onChange={(e) => onChange({ ...value, tradingName: e.target.value })} />
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Company Number</span>
            <input className="input" value={value.companyNumber} onChange={(e) => onChange({ ...value, companyNumber: e.target.value })} />
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">VAT Number</span>
            <input className="input" value={value.vatNumber} onChange={(e) => onChange({ ...value, vatNumber: e.target.value })} />
          </label>
          <label className="dev-form__field admin-form__field--wide">
            <span className="dev-form__label">Address Line 1</span>
            <input className="input" value={value.addressLine1} onChange={(e) => onChange({ ...value, addressLine1: e.target.value })} />
            {errors.addressLine1 ? <span className="setup-step__error">{errors.addressLine1}</span> : null}
          </label>
          <label className="dev-form__field admin-form__field--wide">
            <span className="dev-form__label">Address Line 2</span>
            <input className="input" value={value.addressLine2} onChange={(e) => onChange({ ...value, addressLine2: e.target.value })} />
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Town / City</span>
            <input className="input" value={value.town} onChange={(e) => onChange({ ...value, town: e.target.value })} />
            {errors.town ? <span className="setup-step__error">{errors.town}</span> : null}
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Postcode</span>
            <input className="input" value={value.postcode} onChange={(e) => onChange({ ...value, postcode: e.target.value })} />
            {errors.postcode ? <span className="setup-step__error">{errors.postcode}</span> : null}
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Financial Year Start (MM-DD)</span>
            <input className="input" value={value.financialYearStart} onChange={(e) => onChange({ ...value, financialYearStart: e.target.value })} />
          </label>
          <label className="dev-form__field">
            <span className="dev-form__label">Default Currency</span>
            <select className="input" value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value })}>
              <option value="GBP">GBP</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
          </label>
        </div>
      </form>
    </section>
  );
}
