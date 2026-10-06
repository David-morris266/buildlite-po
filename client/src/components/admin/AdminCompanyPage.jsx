import { useEffect, useRef, useState } from 'react';
import { getCompanySettings, loadCompanyLogo, removeCompanyLogo, saveCompanySettings, uploadCompanyLogo } from '../../api/companySettings';
import { cacheAuthoritativeCompanySettings, CVR_PERIOD_OPTIONS, FORECAST_BEHAVIOUR_OPTIONS } from '../../admin/companyStore';
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
  { id: 'commercial-defaults', label: 'Commercial Defaults' },
  { id: 'numbering', label: 'Numbering' },
  { id: 'branding', label: 'Branding' },
];

export default function AdminCompanyPage({ onBack, initialSection = 'identity', onSectionChange }) {
  const [form, setForm] = useState({companyName:'',tradingName:'',companyNumber:'',vatRegistrationNumber:'',registeredOffice:'',website:'',currency:'GBP',financialYearStart:'04-01',vatRate:20,defaultRetentionPercent:5,defaultCvrPeriod:'Monthly',defaultForecastBehaviour:'Committed',numberingPrefixes:{}});
  const [version,setVersion]=useState(0);
  const [error,setError]=useState('');
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState(initialSection);
  const [branding,setBranding]=useState({version:0,logo:null});
  const [logoFile,setLogoFile]=useState(null);
  const [logoPreview,setLogoPreview]=useState('');
  const [savedLogoPreview,setSavedLogoPreview]=useState('');
  const [logoBusy,setLogoBusy]=useState(false);
  const [logoMessage,setLogoMessage]=useState('');
  const logoInput=useRef(null);

  useEffect(() => {
    getCompanySettings().then(result=>{cacheAuthoritativeCompanySettings(result.settings);setForm(result.settings);setVersion(result.version);setBranding(result.branding||{version:0,logo:null});}).catch(e=>setError(e.message));
  }, []);
  useEffect(() => { setActiveSection(initialSection); }, [initialSection]);

  useEffect(()=>{let active=true,objectUrl='';if(!branding.logo?.displayUrl){setSavedLogoPreview('');return()=>{active=false;};}loadCompanyLogo(branding.logo.displayUrl).then(blob=>{if(!active)return;objectUrl=URL.createObjectURL(blob);setSavedLogoPreview(objectUrl);}).catch(()=>{if(active)setLogoMessage('The saved company logo could not be displayed.');});return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[branding.logo?.displayUrl]);

  useEffect(()=>{if(!logoFile){setLogoPreview('');return;}const url=URL.createObjectURL(logoFile);setLogoPreview(url);return()=>URL.revokeObjectURL(url);},[logoFile]);

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

  async function handleSave(event) {
    event.preventDefault();
    setError('');
    try{const result=await saveCompanySettings(form,version);cacheAuthoritativeCompanySettings(result.settings);setForm(result.settings);setVersion(result.version);setSaved(true);}catch(e){setError(e.message);}
  }

  function chooseLogo(file){setLogoMessage('');if(!file)return;if(file.size>2*1024*1024){setLogoMessage('Choose a PNG, JPEG or WebP image no larger than 2 MB.');return;}setLogoFile(file);}
  async function saveLogo(){if(!logoFile)return;setLogoBusy(true);setLogoMessage('');try{const result=await uploadCompanyLogo(logoFile,branding.version);setBranding(result);setLogoFile(null);setLogoMessage('Company logo saved.');}catch(e){setLogoMessage(e.message);}finally{setLogoBusy(false);}}
  async function removeLogo(){if(!branding.logo||!window.confirm('Remove the saved company logo? New documents will use the company name instead.'))return;setLogoBusy(true);setLogoMessage('');try{const result=await removeCompanyLogo(branding.version);setBranding(result);setLogoFile(null);setLogoMessage('Company logo removed.');}catch(e){setLogoMessage(e.message);}finally{setLogoBusy(false);}}

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
      {error?<div role="alert" className="po-list-feedback po-list-feedback--error">{error}</div>:null}

      <AdminSectionNav sections={SECTIONS} active={activeSection} onChange={(section) => { setActiveSection(section); onSectionChange?.(section); }} />

      <form id="admin-company-form" className="admin-form-stack" onSubmit={handleSave}>
        {activeSection === 'identity' ? (
          <section className="po-module-card admin-panel admin-fade-in">
            <h2 className="admin-panel__title">Company Identity</h2>
            <div className="admin-form__grid">
              <label className="dev-form__field">
                <span className="dev-form__label">Company Name</span>
                <input className="input" value={form.companyName} readOnly aria-describedby="company-name-authority" />
                <small id="company-name-authority">Provisioned company identity. Contact the BuildLite platform owner to rename the tenant.</small>
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

        {activeSection === 'commercial-defaults' ? (
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
            <div className="admin-branding">
              <div className="admin-branding__preview">
                {logoPreview||savedLogoPreview?<img src={logoPreview||savedLogoPreview} alt="Company logo preview"/>:<span>{form.companyName||'Company'}<small>No logo uploaded</small></span>}
              </div>
              {logoPreview?<p className="admin-branding__pending">Unsaved preview — save to use this logo on new documents.</p>:null}
              <input ref={logoInput} className="admin-branding__file" type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{chooseLogo(event.target.files?.[0]);event.target.value='';}} />
              <div className="admin-branding__actions">
                <AdminButton type="button" onClick={()=>logoInput.current?.click()} disabled={logoBusy}>{branding.logo?'Choose replacement':'Upload logo'}</AdminButton>
                {logoFile?<AdminButton type="button" variant="primary" onClick={saveLogo} disabled={logoBusy}>{logoBusy?'Saving…':'Save logo'}</AdminButton>:null}
                {logoFile?<AdminButton type="button" onClick={()=>setLogoFile(null)} disabled={logoBusy}>Cancel</AdminButton>:null}
                {branding.logo&&!logoFile?<AdminButton type="button" onClick={removeLogo} disabled={logoBusy}>Remove logo</AdminButton>:null}
              </div>
              <small>PNG, JPEG or WebP. Maximum 2 MB. The image is validated and prepared for BuildLite documents.</small>
              {logoMessage?<div role="status" className="po-list-feedback">{logoMessage}</div>:null}
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
