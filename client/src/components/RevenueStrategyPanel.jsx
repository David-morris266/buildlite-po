import { useEffect, useMemo, useState } from 'react';
import { formatMoney } from './poDrawerHelpers';
import {
  AFFORDABLE_HOUSING_TYPES,
  GARAGE_TYPES,
} from '../revenue/revenueTypes';
import { calculateRatePerM2 } from '../revenue/revenueStrategyCalculations';
import {
  buildSaveStrategySummary,
  runSaveStrategyApplyWorkflow,
  saveRevenueStrategyOnly,
} from '../revenue/revenueBulkWorkflow';
import { getRevenueStrategy } from '../revenue/revenueStrategy';
import {
  RevenueConfirmDialog,
  RevenueProgressPanel,
  RevenueToast,
} from './revenue/RevenueWorkflowUi';
import { useRevenueWorkflowState } from './revenue/useRevenueWorkflow';

function StrategyField({ label, children, hint }) {
  return (
    <label className="revenue-strategy__field">
      <span className="revenue-strategy__label">{label}</span>
      {children}
      {hint ? <span className="revenue-strategy__hint">{hint}</span> : null}
    </label>
  );
}

export default function RevenueStrategyPanel({
  developmentId,
  refreshToken = 0,
  onStrategyChanged,
  onDraftChange,
}) {
  const stored = useMemo(() => {
    void refreshToken;
    return getRevenueStrategy(developmentId);
  }, [developmentId, refreshToken]);

  const [draft, setDraft] = useState(stored);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  // TODO BL-019C.9
  // Manual dev environment occasionally leaves Revenue Strategy
  // page visually dimmed after Save→Yes.
  // Persistence and recalculation complete successfully.
  // Production build and automated tests do not reproduce.
  // Investigate after BL-019D.
  const { toast, progress, busyActionKey, clearToast, runAction } = useRevenueWorkflowState();

  useEffect(() => {
    setDraft(stored);
  }, [stored]);

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  const ratePerM2 = useMemo(
    () => calculateRatePerM2(draft.openMarket.ratePerFt2),
    [draft.openMarket.ratePerFt2]
  );

  const isBusy = busyActionKey === 'save-strategy';

  function updateOpenMarket(field, value) {
    setDraft((prev) => ({
      ...prev,
      openMarket: { ...prev.openMarket, [field]: value },
    }));
  }

  function updateAffordable(key, value) {
    setDraft((prev) => ({
      ...prev,
      affordableHousing: { ...prev.affordableHousing, [key]: value },
    }));
  }

  function updateGaragePremium(key, value) {
    setDraft((prev) => ({
      ...prev,
      garagePremiums: { ...prev.garagePremiums, [key]: value },
    }));
  }

  function handleSaveClick() {
    setSaveDialogOpen(true);
  }

  function handleDismissDialog() {
    if (isBusy) return;
    setSaveDialogOpen(false);
  }

  async function handleSaveWithoutApply() {
    setSaveDialogOpen(false);
    if (isBusy) return;

    await runAction('save-strategy', {
      progressLabel: 'Saving Revenue Strategy...',
      execute: () => {
        const result = saveRevenueStrategyOnly(developmentId, draft);
        if (!result.ok) throw new Error('Could not save revenue strategy.');
        return { ok: true, applied: false };
      },
      buildToast: () => 'Revenue Strategy saved.',
      onPersisted: () => onStrategyChanged?.(),
    });
  }

  async function handleSaveWithApply() {
    setSaveDialogOpen(false);
    if (isBusy) return;

    await runAction('save-strategy', {
      progressLabel: 'Updating Revenue Strategy...',
      execute: async () => {
        const result = await runSaveStrategyApplyWorkflow(developmentId, draft);
        if (!result.ok) throw new Error(result.errors?.[0] || 'Could not save revenue strategy.');
        return result;
      },
      buildToast: (result) => buildSaveStrategySummary(result)?.replace(/\n/g, ' · ') || 'Revenue Strategy saved.',
      onPersisted: (result) => onStrategyChanged?.(result),
    });
  }

  return (
    <section className="po-module-card revenue-strategy revenue-strategy--compact" aria-labelledby="revenue-strategy-title">
      <RevenueToast message={toast} onDismiss={clearToast} />
      <RevenueProgressPanel progress={progress} />

      <header className="revenue-strategy__header">
        <div className="revenue-strategy__header-copy">
          <h2 id="revenue-strategy-title" className="po-matrix-section__title">Pricing Assumptions</h2>
          <p className="revenue-workspace__lead revenue-strategy__lead">
            Development-wide defaults for auto-priced plots.
          </p>
        </div>
        <button type="button" className="po-btn-primary revenue-strategy__save" onClick={handleSaveClick} disabled={isBusy}>
          {isBusy ? 'Saving…' : 'Save Strategy'}
        </button>
      </header>

      <div className="revenue-strategy__compact-grid">
        <div className="revenue-strategy__compact-group">
          <h3 className="revenue-strategy__compact-label">Open Market</h3>
          <div className="revenue-strategy__compact-fields">
            <StrategyField label="£/ft²">
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                value={draft.openMarket.ratePerFt2 || ''}
                disabled={isBusy}
                onChange={(event) => updateOpenMarket('ratePerFt2', event.target.value)}
              />
            </StrategyField>
            <StrategyField label="£/m²">
              <input className="input" type="text" value={`£${formatMoney(ratePerM2)}`} readOnly />
            </StrategyField>
            <StrategyField label="Effective">
              <input
                className="input"
                type="date"
                value={draft.openMarket.effectiveDate || ''}
                disabled={isBusy}
                onChange={(event) => updateOpenMarket('effectiveDate', event.target.value)}
              />
            </StrategyField>
          </div>
        </div>

        <div className="revenue-strategy__compact-group revenue-strategy__compact-group--affordable">
          <h3 className="revenue-strategy__compact-label">Affordable (% OMV)</h3>
          <div className="revenue-strategy__compact-fields revenue-strategy__compact-fields--affordable">
            {AFFORDABLE_HOUSING_TYPES.map((item) => (
              <StrategyField key={item.key} label={item.label}>
                <div className="revenue-strategy__percent-wrap">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={draft.affordableHousing[item.key] ?? ''}
                    disabled={isBusy}
                    onChange={(event) => updateAffordable(item.key, event.target.value)}
                  />
                  <span className="revenue-strategy__suffix">%</span>
                </div>
              </StrategyField>
            ))}
          </div>
        </div>

        <div className="revenue-strategy__compact-group">
          <h3 className="revenue-strategy__compact-label">Garage Premiums</h3>
          <div className="revenue-strategy__compact-fields">
            {GARAGE_TYPES.map((garage) => {
              const key = garage.toLowerCase();
              return (
                <StrategyField key={garage} label={garage}>
                  <div className="revenue-strategy__money-wrap">
                    <span className="revenue-strategy__prefix">£</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="500"
                      value={draft.garagePremiums[key] ?? ''}
                      disabled={isBusy}
                      onChange={(event) => updateGaragePremium(key, event.target.value)}
                    />
                  </div>
                </StrategyField>
              );
            })}
          </div>
        </div>
      </div>

      <RevenueConfirmDialog
        open={saveDialogOpen}
        title="Save Revenue Strategy"
        message="Apply these changes to all Auto-priced plots?"
        confirmLabel="Yes"
        cancelLabel="Cancel"
        busy={isBusy}
        onCancel={handleDismissDialog}
        onSecondary={handleSaveWithoutApply}
        secondaryLabel="No"
        onConfirm={handleSaveWithApply}
      />
    </section>
  );
}
