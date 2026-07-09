import { useEffect, useState } from 'react';
import PODrawerShell from './PODrawerShell';
import { PLOT_DEFAULT_STATUS, PLOT_CONFIGURATION_SUGGESTIONS } from '../developments/plotMaster';

const EMPTY_FORM = {
  plotNumber: '',
  houseType: '',
  configuration: '',
  bedrooms: '',
  gia: '',
  phase: '',
  tenure: '',
};

export default function PlotDrawer({
  open,
  plot,
  saveErrors = [],
  onClose,
  onSave,
}) {
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (!open) return;
    if (plot) {
      setForm({
        plotNumber: plot.plotNumber || '',
        houseType: plot.houseType || '',
        configuration: plot.configuration || '',
        bedrooms: plot.bedrooms ?? '',
        gia: plot.gia ?? '',
        phase: plot.phase || '',
        tenure: plot.tenure || '',
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, plot]);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSave?.({
      ...form,
      status: plot?.status || PLOT_DEFAULT_STATUS,
    });
  }

  return (
    <PODrawerShell
      open={open}
      onClose={onClose}
      ariaLabel={plot ? 'Edit plot' : 'Add plot'}
    >
      <header className="po-drawer-header">
        <div className="po-drawer-header__bar">
          <p className="po-drawer-header__eyebrow">Plot Master</p>
          <button type="button" className="po-drawer-header__close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="po-drawer-header__hero">
          <h2 className="po-drawer-header__number">
            {plot ? `Edit ${plot.plotNumber}` : 'Add Plot'}
          </h2>
        </div>
      </header>

      <form className="po-drawer-body dev-plot-drawer" onSubmit={handleSubmit}>
        {saveErrors.length ? (
          <div className="po-list-feedback po-list-feedback--error" role="alert">
            <ul className="dev-plot-drawer__errors">
              {saveErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <section className="po-drawer-section">
          <h3 className="po-drawer-section__title">Plot details</h3>
          <div className="dev-form__grid">
            <label className="dev-form__field">
              <span className="dev-form__label">Plot Number *</span>
              <input
                className="input"
                type="text"
                value={form.plotNumber}
                onChange={(event) => updateField('plotNumber', event.target.value)}
                required
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">House Type *</span>
              <input
                className="input"
                type="text"
                value={form.houseType}
                onChange={(event) => updateField('houseType', event.target.value)}
                required
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Configuration</span>
              <input
                className="input"
                type="text"
                list="plot-configuration-suggestions"
                value={form.configuration}
                onChange={(event) => updateField('configuration', event.target.value)}
                placeholder="e.g. Detached, End Terrace"
              />
              <datalist id="plot-configuration-suggestions">
                {PLOT_CONFIGURATION_SUGGESTIONS.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Bedrooms</span>
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                value={form.bedrooms}
                onChange={(event) => updateField('bedrooms', event.target.value)}
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Gross Internal Area</span>
              <input
                className="input"
                type="number"
                min="0"
                step="0.1"
                value={form.gia}
                onChange={(event) => updateField('gia', event.target.value)}
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Phase</span>
              <input
                className="input"
                type="text"
                value={form.phase}
                onChange={(event) => updateField('phase', event.target.value)}
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Tenure</span>
              <input
                className="input"
                type="text"
                value={form.tenure}
                onChange={(event) => updateField('tenure', event.target.value)}
              />
            </label>
          </div>
        </section>

        <footer className="po-drawer-footer">
          <button type="submit" className="po-btn-primary">
            {plot ? 'Save Plot' : 'Add Plot'}
          </button>
          <button type="button" className="po-list-btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </form>
    </PODrawerShell>
  );
}
