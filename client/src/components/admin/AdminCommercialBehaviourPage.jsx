import { useMemo, useState } from 'react';
import {
  FORECAST_SOURCE_OPTIONS,
  getCommercialBehaviourSettings,
  saveAllCommercialBehaviours,
} from '../../admin/commercialBehaviourStore';
import { getActiveHeadNames } from '../../admin/commercialStructureStore';
import AdminPageShell from './AdminPageShell';
import { AdminButton, AdminKpiGrid } from './adminUi';

export default function AdminCommercialBehaviourPage({ onBack }) {
  const [refresh, setRefresh] = useState(0);
  const [saved, setSaved] = useState(false);

  const settings = useMemo(() => {
    void refresh;
    return getCommercialBehaviourSettings();
  }, [refresh]);

  const heads = getActiveHeadNames();

  function updateHead(headName, field, value) {
    setSaved(false);
    const next = {
      ...settings.behaviours,
      [headName]: {
        ...settings.behaviours[headName],
        [field]: value,
      },
    };
    saveAllCommercialBehaviours(next);
    setRefresh((value) => value + 1);
  }

  function handleSave() {
    saveAllCommercialBehaviours(settings.behaviours);
    setSaved(true);
  }

  return (
    <AdminPageShell
      title="Commercial Behaviour"
      lead="Default commercial behaviour by Commercial Head. Configuration only — no engine changes in this sprint."
      onBack={onBack}
    >
      <AdminKpiGrid
        items={[
          { label: 'Commercial Heads', value: heads.length },
          {
            label: 'On Executive Summary',
            value: heads.filter((head) => settings.behaviours[head]?.includeOnExecutiveSummary !== false).length,
            tone: 'success',
          },
        ]}
      />

      <div className="admin-behaviour-grid">
        {heads.map((headName) => {
          const behaviour = settings.behaviours[headName];
          return (
            <section key={headName} className="po-module-card admin-behaviour-card">
              <header className="admin-behaviour-card__head">
                <h2>{headName}</h2>
                <span className="admin-future-badge">Configuration</span>
              </header>
              <div className="admin-form__grid">
                <label className="dev-form__field">
                  <span className="dev-form__label">Forecast Source</span>
                  <select
                    className="input"
                    value={behaviour.forecastSource}
                    onChange={(e) => updateHead(headName, 'forecastSource', e.target.value)}
                  >
                    {FORECAST_SOURCE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Default Journal Allowed</span>
                  <select
                    className="input"
                    value={behaviour.defaultJournalAllowed ? 'yes' : 'no'}
                    onChange={(e) => updateHead(headName, 'defaultJournalAllowed', e.target.value === 'yes')}
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Negative CTC Warning</span>
                  <select
                    className="input"
                    value={behaviour.negativeCtcWarning ? 'yes' : 'no'}
                    onChange={(e) => updateHead(headName, 'negativeCtcWarning', e.target.value === 'yes')}
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label className="dev-form__field">
                  <span className="dev-form__label">Include on Executive Summary</span>
                  <select
                    className="input"
                    value={behaviour.includeOnExecutiveSummary ? 'yes' : 'no'}
                    onChange={(e) => updateHead(headName, 'includeOnExecutiveSummary', e.target.value === 'yes')}
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
              </div>
            </section>
          );
        })}
      </div>

      <div className="admin-form__actions">
        <AdminButton type="button" variant="primary" onClick={handleSave}>Save Commercial Behaviour</AdminButton>
        {saved ? <span className="admin-form__saved">Saved</span> : null}
      </div>
    </AdminPageShell>
  );
}
