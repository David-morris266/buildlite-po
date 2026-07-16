import { useEffect, useMemo, useState } from 'react';
import { formatMoney } from './poDrawerHelpers';
import { GARAGE_TYPES, SELLING_BASIS_OPTIONS } from '../revenue/revenueTypes';
import {
  getHouseTypePricing,
  saveHouseTypePricing,
  syncPlotForecastPrices,
} from '../revenue/revenueStrategy';
import { RevenueProgressPanel, RevenueToast } from './revenue/RevenueWorkflowUi';
import { useRevenueWorkflowState } from './revenue/useRevenueWorkflow';

export default function HouseTypeRevenueTable({
  developmentId,
  refreshToken = 0,
  houseTypeRows = [],
  onChanged,
  onDraftChange,
}) {
  const houseTypePricing = useMemo(() => {
    void refreshToken;
    return getHouseTypePricing(developmentId);
  }, [developmentId, refreshToken]);

  const [draft, setDraft] = useState(houseTypePricing);
  const { toast, progress, busyActionKey, clearToast, runAction } = useRevenueWorkflowState();
  const isBusy = busyActionKey === 'save-house-types';

  useEffect(() => {
    setDraft(houseTypePricing);
  }, [houseTypePricing]);

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  function updateHouseType(houseType, patch) {
    setDraft((prev) => ({
      ...prev,
      [houseType]: {
        ...prev[houseType],
        ...patch,
      },
    }));
  }

  async function handleSave() {
    await runAction('save-house-types', {
      progressLabel: 'Saving House Type Pricing...',
      execute: () => {
        saveHouseTypePricing(developmentId, draft);
        const syncResult = syncPlotForecastPrices(developmentId);
        return {
          ok: true,
          houseTypeCount: Object.keys(draft).length,
          plotsRecalculated: syncResult.updatedCount,
        };
      },
      buildToast: (result) => {
        const parts = ['House Type Pricing saved.'];
        if (result.houseTypeCount > 0) {
          parts.push(
            `${result.houseTypeCount} House Type${result.houseTypeCount === 1 ? '' : 's'} updated.`
          );
        }
        if (result.plotsRecalculated > 0) {
          parts.push(
            `${result.plotsRecalculated} plot forecast${result.plotsRecalculated === 1 ? '' : 's'} recalculated.`
          );
        }
        return parts.join(' ');
      },
      onPersisted: (result) => onChanged?.(result),
    });
  }

  if (!houseTypeRows.length) {
    return (
      <section className="po-module-card revenue-house-types" aria-labelledby="house-type-pricing-title">
        <header className="revenue-workspace__header">
          <h2 id="house-type-pricing-title" className="po-matrix-section__title">House Type Pricing</h2>
          <p className="revenue-workspace__lead">
            House types will appear automatically once plots are added in Plot Master.
          </p>
        </header>
      </section>
    );
  }

  return (
    <section className="po-module-card revenue-house-types" aria-labelledby="house-type-pricing-title">
      <RevenueToast message={toast} onDismiss={clearToast} />
      <RevenueProgressPanel progress={progress} />

      <header className="revenue-workspace__header">
        <h2 id="house-type-pricing-title" className="po-matrix-section__title">House Type Pricing</h2>
        <p className="revenue-workspace__lead">
          Base values per house type. Forecast = NIA × development £/ft² + garage premium unless manually overridden.
        </p>
      </header>

      <div className="po-table-wrap">
        <table className="po-data-table revenue-house-types__table">
          <thead>
            <tr>
              <th>House Type</th>
              <th>NIA</th>
              <th>Garage</th>
              <th>Selling Basis</th>
              <th>Forecast Value</th>
              <th>Manual Value</th>
            </tr>
          </thead>
          <tbody>
            {houseTypeRows.map((row) => {
              const record = draft[row.houseType] || {};
              return (
                <tr key={row.houseType}>
                  <td>{row.houseType}</td>
                  <td>{row.niaFt2 ? `${row.niaFt2.toLocaleString('en-GB')} ft²` : '—'}</td>
                  <td>
                    <select
                      className="input revenue-house-types__inline-input"
                      value={record.garage || row.garage}
                      disabled={isBusy}
                      onChange={(event) => updateHouseType(row.houseType, { garage: event.target.value })}
                    >
                      {GARAGE_TYPES.map((garage) => (
                        <option key={garage} value={garage}>{garage}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="input revenue-house-types__inline-input"
                      value={record.sellingBasis || row.sellingBasis}
                      disabled={isBusy}
                      onChange={(event) =>
                        updateHouseType(row.houseType, { sellingBasis: event.target.value })
                      }
                    >
                      {SELLING_BASIS_OPTIONS.map((basis) => (
                        <option key={basis} value={basis}>{basis}</option>
                      ))}
                    </select>
                  </td>
                  <td>£{formatMoney(row.forecastValue)}</td>
                  <td>
                    {(record.sellingBasis || row.sellingBasis) === 'Manual' ? (
                      <input
                        className="input revenue-house-types__inline-input"
                        type="number"
                        min="0"
                        step="1000"
                        disabled={isBusy}
                        value={record.manualForecastValue ?? ''}
                        onChange={(event) =>
                          updateHouseType(row.houseType, {
                            manualForecastValue: event.target.value,
                          })
                        }
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="revenue-house-types__actions">
        <button type="button" className="po-btn-primary" onClick={handleSave} disabled={isBusy}>
          {isBusy ? 'Saving…' : 'Save House Type Pricing'}
        </button>
      </footer>
    </section>
  );
}
