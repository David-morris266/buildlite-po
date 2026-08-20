import { useEffect, useMemo, useState } from 'react';
import PODrawerShell from './PODrawerShell';
import { listRevenueCategoryNames, getDefaultRevenueCategory } from '../admin/revenueCategoryStore';
import {
  PLOT_DEFAULT_STATUS,
  PLOT_CONFIGURATION_SUGGESTIONS,
} from '../developments/plotMaster';
import { getPlotNiaM2 } from '../developments/plotCommercial';
import { REVENUE_STATUSES, stampLifecycleDatesOnStatusChange } from '../developments/plotCommercial';
import { GARAGE_TYPES, REVENUE_SOURCES } from '../revenue/revenueTypes';
import { resolvePlotForecastPrice } from '../revenue/revenueStrategyCalculations';
import {
  getHouseTypePricing,
  getRevenueStrategy,
} from '../revenue/revenueStrategy';
import { getPlots } from '../developments/plotMaster';

const EMPTY_FORM = {
  plotNumber: '',
  houseType: '',
  configuration: '',
  bedrooms: '',
  gia: '',
  niaFt2: '',
  phase: '',
  tenure: '',
  sellingPrice: '',
  revenueCategory: '',
  revenueStatus: 'Available',
  revenueSource: 'House Type',
  garage: 'None',
  plotPremium: '',
  plotPremiumReason: '',
  manualForecastValue: '',
  plotOverrideValue: '',
  reservedAt: '',
  exchangedAt: '',
  completedAt: '',
};

export default function PlotDrawer({
  open,
  plot,
  developmentId,
  openedFrom = 'PlotMaster',
  saveErrors = [],
  onClose,
  onSave,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const categoryOptions = listRevenueCategoryNames();

  useEffect(() => {
    if (!open) return;
    if (plot) {
      setForm({
        plotNumber: plot.plotNumber || '',
        houseType: plot.houseType || '',
        configuration: plot.configuration || '',
        bedrooms: plot.bedrooms ?? '',
        gia: plot.gia ?? '',
        niaFt2: plot.niaFt2 ?? plot.gia ?? '',
        phase: plot.phase || '',
        tenure: plot.tenure || '',
        sellingPrice: plot.sellingPrice ?? '',
        revenueCategory: plot.revenueCategory || getDefaultRevenueCategory(),
        revenueStatus: plot.revenueStatus || 'Available',
        revenueSource: plot.revenueSource || 'House Type',
        garage: plot.garage || 'None',
        plotPremium: plot.plotPremium ?? '',
        plotPremiumReason: plot.plotPremiumReason || '',
        manualForecastValue: plot.manualForecastValue ?? '',
        plotOverrideValue: plot.plotOverrideValue ?? '',
        reservedAt: plot.reservedAt || '',
        exchangedAt: plot.exchangedAt || '',
        completedAt: plot.completedAt || '',
      });
    } else {
      setForm({
        ...EMPTY_FORM,
        revenueCategory: getDefaultRevenueCategory(),
      });
    }
  }, [open, plot]);

  function updateField(field, value) {
    setForm((prev) => {
      if (field === 'revenueStatus') {
        return stampLifecycleDatesOnStatusChange(prev, value);
      }
      const next = { ...prev, [field]: value };
      if (field === 'garage') {
        next.garageOverride = true;
      }
      return next;
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    const strategy = getRevenueStrategy(developmentId || plot?.developmentId);
    const houseTypePricing = getHouseTypePricing(developmentId || plot?.developmentId);
    const plots = developmentId || plot?.developmentId ? getPlots(developmentId || plot.developmentId) : [];
    const payload = {
      ...form,
      status: plot?.status || PLOT_DEFAULT_STATUS,
    };
    if (payload.revenueSource !== 'Manual Value') {
      payload.forecastSellingPrice = resolvePlotForecastPrice(
        payload,
        strategy,
        houseTypePricing,
        plots
      );
      payload.manualOverrideExplicit = false;
      payload.manualForecastValue = 0;
    } else {
      payload.forecastSellingPrice = payload.manualForecastValue;
      payload.manualOverrideExplicit = true;
    }
    if (!payload.garageOverride) {
      payload.garageOverride = false;
    }
    onSave?.(payload);
  }

  const displayNiaM2 = useMemo(() => {
    const value = getPlotNiaM2({ niaFt2: form.niaFt2, gia: form.gia });
    return value > 0 ? value.toFixed(2) : '';
  }, [form.niaFt2, form.gia]);

  const drawerEyebrow = openedFrom === 'Revenue' ? 'Revenue' : 'Plot Master';
  const closeLabel = openedFrom === 'Revenue' ? 'Back to Revenue' : 'Close';

  return (
    <PODrawerShell
      open={open}
      onClose={onClose}
      ariaLabel={plot ? 'Edit plot' : 'Add plot'}
    >
      <header className="po-drawer-header">
        <div className="po-drawer-header__bar">
          <p className="po-drawer-header__eyebrow">{drawerEyebrow}</p>
          <button type="button" className="po-drawer-header__close" onClick={onClose}>
            {closeLabel}
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
              <span className="dev-form__label">Gross Internal Area (ft²)</span>
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
              <span className="dev-form__label">NIA (ft²)</span>
              <input
                className="input"
                type="number"
                min="0"
                step="0.1"
                value={form.niaFt2}
                onChange={(event) => updateField('niaFt2', event.target.value)}
                placeholder="Defaults to GIA when blank"
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">NIA (m²)</span>
              <input
                className="input"
                type="text"
                readOnly
                value={displayNiaM2}
                aria-readonly="true"
                placeholder="Calculated from NIA ft²"
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

        <section className="po-drawer-section">
          <h3 className="po-drawer-section__title">Plot pricing</h3>
          <div className="dev-form__grid">
            <label className="dev-form__field">
              <span className="dev-form__label">Revenue Source</span>
              <select
                className="input"
                value={form.revenueSource}
                onChange={(event) => updateField('revenueSource', event.target.value)}
              >
                {REVENUE_SOURCES.map((source) => (
                  <option key={source} value={source}>{source}</option>
                ))}
              </select>
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Garage</span>
              <select
                className="input"
                value={form.garage}
                onChange={(event) => updateField('garage', event.target.value)}
              >
                {GARAGE_TYPES.map((garage) => (
                  <option key={garage} value={garage}>{garage}</option>
                ))}
              </select>
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Plot Premium</span>
              <input
                className="input"
                type="number"
                step="1000"
                value={form.plotPremium}
                onChange={(event) => updateField('plotPremium', event.target.value)}
                placeholder="e.g. 10000 or -15000"
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Premium Reason</span>
              <input
                className="input"
                type="text"
                value={form.plotPremiumReason}
                onChange={(event) => updateField('plotPremiumReason', event.target.value)}
                placeholder="e.g. Corner plot"
              />
            </label>
            {form.revenueSource === 'Manual Value' ? (
              <label className="dev-form__field">
                <span className="dev-form__label">Manual Forecast Value</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="1000"
                  value={form.manualForecastValue}
                  onChange={(event) => updateField('manualForecastValue', event.target.value)}
                />
              </label>
            ) : null}
            {form.revenueSource === 'Plot Override' ? (
              <label className="dev-form__field">
                <span className="dev-form__label">Plot Override Value</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="1000"
                  value={form.plotOverrideValue}
                  onChange={(event) => updateField('plotOverrideValue', event.target.value)}
                />
              </label>
            ) : null}
          </div>
        </section>

        <section className="po-drawer-section">
          <h3 className="po-drawer-section__title">Commercial sales</h3>
          <div className="dev-form__grid">
            <label className="dev-form__field">
              <span className="dev-form__label">Selling Price</span>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={form.sellingPrice}
                onChange={(event) => updateField('sellingPrice', event.target.value)}
                placeholder="Contractual sale price from exchange"
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Revenue Category</span>
              <select
                className="input"
                value={form.revenueCategory}
                onChange={(event) => updateField('revenueCategory', event.target.value)}
              >
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Revenue Status</span>
              <select
                className="input"
                value={form.revenueStatus}
                onChange={(event) => updateField('revenueStatus', event.target.value)}
              >
                {REVENUE_STATUSES.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Reserved date</span>
              <input
                className="input"
                type="date"
                value={form.reservedAt}
                onChange={(event) => updateField('reservedAt', event.target.value)}
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Exchange date</span>
              <input
                className="input"
                type="date"
                value={form.exchangedAt}
                onChange={(event) => updateField('exchangedAt', event.target.value)}
              />
            </label>
            <label className="dev-form__field">
              <span className="dev-form__label">Completion date</span>
              <input
                className="input"
                type="date"
                value={form.completedAt}
                onChange={(event) => updateField('completedAt', event.target.value)}
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
