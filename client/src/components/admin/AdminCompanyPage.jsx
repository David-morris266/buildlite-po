import { useEffect, useState } from 'react';
import {
  CVR_PERIOD_OPTIONS,
  FORECAST_BEHAVIOUR_OPTIONS,
  getCompanySettings,
  saveCompanySettings,
} from '../../admin/companyStore';
import AdminPageShell from './AdminPageShell';
import { AdminButton, AdminKpiGrid, AdminSectionNav } from './adminUi';

const NUMBERING_FIELDS = [
  ['development', 'Development'],
  ['purchaseOrder', 'Purchase Order'],
  ['paymentCertificate', 'Payment Certificate'],
  ['cvr', 'CVR'],
  ['variationOrder', 'Variation Order'],
  ['salesPlot', 'Sales Plot'],
];

const SECTIONS = [
  { id: 'identity', label: 'Company Identity' },
  { id: 'financial', label: 'Financial' },
  { id: 'commercial', label: 'Commercial Defaults' },
  { id: 'numbering', label: 'Numbering' },
  { id: 'branding', label: 'Branding' },
];

export default function AdminCompanyPage({ onBack }) {
  const [form, setForm] = useState(getCompanySettings());
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState('identity');

  useEffect(() => {
    setForm(getCompanySettings());
  }, []);

  function updateField(field, value) {
    setSaved(false);
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updatePrefix(field, value) {
    setSaved(false);
    setForm((prev) => ({
      ...prev,
      numberingPrefixes: { ...prev.numberingPrefixes, [field]: value },
    }));
  }

  function handleSave(event) {
    event.preventDefault();
    saveCompanySettings(form);
    setSaved(true);
  }

  return (
    <AdminPageShell
      title="Company"
      lead="Company identity, financial defaults and numbering rules used across BuildLite."
      onBack={onBack}
      actions={
        <AdminButton type="submit" form="admin-company-form" variant="primary">
          Save Company Settings
        </AdminButton>
      }
    >
      <AdminKpiGrid
        items={[
          { label: 'Company', value: form.companyName || form.tradingName || 'Not set' },
          { label: 'Currency', value: form.currency || 'GBP' },
          { label: 'VAT Rate', value: `${form.vatRate ?? 20}%` },
          { label: 'CVR Period', value: form.defaultCvrPeriod },
        ]}
      />

      <AdminSectionNav sections={SECTIONS} active={activeSection} onChange={setActiveSection} />

      <form id="admin-company-form" className="admin-form-stack" onSubmit={handleSave}>
        {activeSection === 'identity' ? (
          <section className="po-module-card admin-panel admin-fade-in">
            <h2 className="admin-panel__title">Company Identity</h2>
            <div className="admin-form__grid">
              <label className="dev-form__field">
                <span className="dev-form__label">Company Name</span>
                <input className="input" value={form.companyName} onChange={(e) => updateField('companyName', e.target.value)} />
              </label>
              <label className="dev-form__field">
                <span className="dev-form__label">Trading Name</span>
                <input className="input" value={form.tradingName} onChange={(e) => updateField('tradingName', e.target.value)} />
              </label>
              <label className="dev-form__field">
                <span className="dev-form__label">Company Number</span>
                <input className="input" value={form.companyNumber} onChange={(e) => updateField('companyNumber', e.target.value)} />
              </label>
              <label className="dev-form__field">
                <span className="dev-form__label">VAT Number</span>
                <input className="input" value={form.vatRegistrationNumber} onChange={(e) => updateField('vatRegistrationNumber', e.target.value)} />
              </label>
              <label className="dev-form__field admin-form__field--wide">
                <span className="dev-form__label">Registered Office</span>
                <textarea className="input" rows={3} value={form.registeredOffice} onChange={(e) => updateField('registeredOffice', e.target.value)} />
              </label>
              <label className="dev-form__field">
                <span className="dev-form__label">Website</span>
                <input className="input" value={form.website} onChange={(e) => updateField('website', e.target.value)} placeholder="https://" />
              </label>
            </div>
          </section>
        ) : null}

        {activeSection === 'financial' ? (
          <section className="po-module-card admin-panel admin-fade-in">
            <h2 className="admin-panel__title">Financial Settings</h2>
            <div className="admin-form__grid">
              <label className="dev-form__field">
                <span className="dev-form__label">Financial Year Start (MM-DD)</span>
                <input className="input" value={form.financialYearStart} onChange={(e) => updateField('financialYearStart', e.target.value)} />
              </label>
              <label className="dev-form__field">
                <span className="dev-form__label">Default Currency</span>
                <input className="input" value={form.currency} onChange={(e) => updateField('currency', e.target.value)} />
              </label>
              <label className="dev-form__field">
                <span className="dev-form__label">VAT Rate (%)</span>
                <input className="input" type="number" min="0" step="0.1" value={form.vatRate} onChange={(e) => updateField('vatRate', e.target.value)} />
              </label>
              <label className="dev-form__field">
                <span className="dev-form__label">Default Retention (%)</span>
                <input className="input" type="number" min="0" step="0.1" value={form.defaultRetentionPercent} onChange={(e) => updateField('defaultRetentionPercent', e.target.value)} />
              </label>
            </div>
          </section>
        ) : null}

        {activeSection === 'commercial' ? (
          <section className="po-module-card admin-panel admin-fade-in">
            <h2 className="admin-panel__title">Commercial Defaults</h2>
            <div className="admin-form__grid">
              <label className="dev-form__field">
                <span className="dev-form__label">Default CVR Period</span>
                <select className="input" value={form.defaultCvrPeriod} onChange={(e) => updateField('defaultCvrPeriod', e.target.value)}>
                  {CVR_PERIOD_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="dev-form__field">
                <span className="dev-form__label">Default Forecast Behaviour</span>
                <select className="input" value={form.defaultForecastBehaviour} onChange={(e) => updateField('defaultForecastBehaviour', e.target.value)}>
                  {FORECAST_BEHAVIOUR_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            </div>
          </section>
        ) : null}

        {activeSection === 'numbering' ? (
          <section className="po-module-card admin-panel admin-fade-in">
            <h2 className="admin-panel__title">Numbering Rules</h2>
            <div className="admin-form__grid">
              {NUMBERING_FIELDS.map(([key, label]) => (
                <label key={key} className="dev-form__field">
                  <span className="dev-form__label">{label}</span>
                  <input className="input" value={form.numberingPrefixes?.[key] || ''} onChange={(e) => updatePrefix(key, e.target.value)} />
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {activeSection === 'branding' ? (
          <section className="po-module-card admin-panel admin-fade-in">
            <h2 className="admin-panel__title">Branding</h2>
            <div className="admin-form__grid">
              <label className="dev-form__field admin-form__field--wide">
                <span className="dev-form__label">Logo</span>
                <div className="admin-placeholder">{form.logoPlaceholder}</div>
                <input className="input" value={form.logoUrl || ''} onChange={(e) => updateField('logoUrl', e.target.value)} placeholder="Logo URL (optional)" />
              </label>
            </div>
          </section>
        ) : null}

        <div className="admin-form__actions">
          <AdminButton type="submit" variant="primary">Save Company Settings</AdminButton>
          {saved ? <span className="admin-form__saved">Saved</span> : null}
        </div>
      </form>
    </AdminPageShell>
  );
}
