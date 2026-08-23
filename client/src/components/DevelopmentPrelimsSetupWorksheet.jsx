import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listCostCodes } from '../api';
import { getCostCodeClassification } from '../api/costCodeClassifications';
import {
  applyDevelopmentPrelimsSetup,
  DevelopmentPrelimsApiError,
  previewDevelopmentPrelimsSetup,
} from '../api/developmentPrelimsItems';
import { listPrelimsTemplates } from '../api/prelimsTemplates';
import { formatCvrMoney } from '../cvr/cvrHelpers';
import { PRELIMS_DRIVERS, PRELIMS_UNRESOLVED_LABELS } from '../prelims/prelimsConstants';
import {
  applyPayloadFromDrafts,
  basisLabel,
  classificationForDraft,
  computeOverlap,
  draftsFromPreview,
  durationLabel,
  isLineReady,
  livePreviewCalculation,
  readyStateLabel,
} from '../prelims/prelimsSetupWorksheet';

function moneyLabel(value) {
  if (value == null) return '—';
  return formatCvrMoney(value);
}

export default function DevelopmentPrelimsSetupWorksheet({ developmentId, onCancel, onApplied }) {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [preview, setPreview] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [classifications, setClassifications] = useState({});
  const [costCodes, setCostCodes] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const creatingRef = useRef(false);

  const loadPreview = useCallback(
    async (nextTemplateId) => {
      setLoading(true);
      setError('');
      try {
        const next = await previewDevelopmentPrelimsSetup(developmentId, {
          templateId: nextTemplateId || undefined,
        });
        setPreview(next);
        setTemplateId(next.template.id);
        setDrafts(draftsFromPreview(next));
      } catch (err) {
        setError(err.message || 'Could not load the Prelims setup worksheet.');
        setPreview(null);
        setDrafts([]);
      } finally {
        setLoading(false);
      }
    },
    [developmentId]
  );

  useEffect(() => {
    let cancelled = false;
    listPrelimsTemplates()
      .then((body) => {
        if (cancelled) return;
        const rows = Array.isArray(body) ? body : body?.templates || [];
        setTemplates(rows);
        const chosen = rows.find((row) => row.isDefault) || rows[0];
        loadPreview(chosen?.id);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Could not load company Prelims templates.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadPreview]);

  useEffect(() => {
    let cancelled = false;
    listCostCodes()
      .then((rows) => {
        if (!cancelled) setCostCodes(Array.isArray(rows) ? rows : rows?.items || []);
      })
      .catch(() => {
        if (!cancelled) setCostCodes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const keys = [...new Set(drafts.map((draft) => String(draft.costCodeKey || '').trim()).filter(Boolean))];
    if (!keys.length) return undefined;
    let cancelled = false;
    Promise.all(
      keys.map(async (key) => {
        try {
          const row = await getCostCodeClassification(key);
          return [key, row];
        } catch {
          return [key, null];
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setClassifications((current) => {
        const next = { ...current };
        for (const [key, row] of entries) next[key] = row;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [drafts]);

  const draftById = useMemo(() => {
    const map = new Map();
    for (const draft of drafts) map.set(draft.templateLineId, draft);
    return map;
  }, [drafts]);

  const readyCount = useMemo(() => {
    if (!preview) return 0;
    return preview.lines.filter((line) => isLineReady(line, draftById.get(line.templateLineId))).length;
  }, [preview, draftById]);

  function updateDraft(templateLineId, field, value) {
    setDrafts((current) =>
      current.map((draft) =>
        draft.templateLineId === templateLineId ? { ...draft, [field]: value } : draft
      )
    );
  }

  async function handleCreate() {
    if (!preview || creatingRef.current || saving) return;
    const payload = applyPayloadFromDrafts(preview, drafts);
    if (!payload.lines.length) {
      setError('Select ready lines and enter a cost code plus site assumption before creating.');
      return;
    }
    creatingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await applyDevelopmentPrelimsSetup(developmentId, payload);
      if (typeof onApplied === 'function') onApplied(result);
    } catch (err) {
      const message =
        err instanceof DevelopmentPrelimsApiError && err.status === 409
          ? 'The company template changed. Reload the worksheet and try again.'
          : err.message || 'Could not create selected Prelims lines.';
      setError(message);
    } finally {
      creatingRef.current = false;
      setSaving(false);
    }
  }

  if (!templates.length && !loading) {
    return (
      <section className="dev-prelims-setup" aria-label="Prelims setup worksheet">
        <p className="dev-workspace__section-lead">
          Create a company Prelims template in Administration before setting up this site.
        </p>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </section>
    );
  }

  return (
    <section className="dev-prelims-setup" aria-label="Prelims setup worksheet">
      <header className="dev-prelims-setup__intro">
        <h3>Prelims setup worksheet</h3>
        <p>
          Enter site-specific assumptions against the company template, then create the selected
          ready lines in one action. Nothing is written until you create. Preview-only cost-code
          mapping does not change the company template.
        </p>
      </header>

      <div className="dev-prelims-setup__toolbar">
        <label>
          Company template
          <select
            className="input"
            value={templateId}
            onChange={(event) => loadPreview(event.target.value)}
            aria-label="Company Prelims template"
            disabled={loading || saving}
          >
            {templates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
                {row.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        <p className="dev-prelims-setup__meta">
          {preview
            ? `${preview.lines.length} template lines · ${readyCount} ready · CVR ${
                preview.reportingMonth || 'no reporting month'
              }`
            : 'Loading worksheet…'}
        </p>
      </div>

      {error ? (
        <p className="dev-workspace__section-lead" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? <p className="dev-workspace__section-lead">Loading setup worksheet…</p> : null}

      {preview ? (
        <div className="dev-prelims-setup__table-wrap">
          <table className="dev-prelims-setup__table">
            <thead>
              <tr>
                <th>Sel</th>
                <th>Prelim</th>
                <th>Driver</th>
                <th>Duration</th>
                <th>Cost code</th>
                <th>State</th>
                <th>Assumption</th>
                <th>Forecast</th>
                <th>Ready</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((line) => {
                const draft = draftById.get(line.templateLineId) || {
                  templateLineId: line.templateLineId,
                  selected: false,
                  costCodeKey: '',
                  monthlyRate: '',
                  lumpSumAmount: '',
                };
                const overlapInfo = computeOverlap(line, draft, preview, drafts);
                const live = livePreviewCalculation(
                  line,
                  draft,
                  preview.programme,
                  preview.reportingMonth
                );
                const classification = classificationForDraft(
                  draft,
                  classifications[String(draft.costCodeKey || '').trim()]?.semanticGroup
                );
                const rowClass = [
                  !line.enabled ? 'dev-prelims-setup__row--disabled' : '',
                  line.alreadyApplied ? 'dev-prelims-setup__row--applied' : '',
                  overlapInfo.overlap ? 'dev-prelims-setup__row--overlap' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                const forecastUnresolved = live.calc.state !== 'resolved';
                return (
                  <tr key={line.templateLineId} className={rowClass}>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(draft.selected) && line.selectable}
                        disabled={!line.selectable || saving}
                        onChange={(event) =>
                          updateDraft(line.templateLineId, 'selected', event.target.checked)
                        }
                        aria-label={`Select ${line.name}`}
                      />
                    </td>
                    <td>
                      <strong>{line.name}</strong>
                      {line.guidance ? (
                        <span className="dev-prelims-setup__guidance">{line.guidance}</span>
                      ) : null}
                    </td>
                    <td>{line.forecastDriver}</td>
                    <td>
                      <span>{durationLabel(line, live.span)}</span>
                      {line.forecastDriver === PRELIMS_DRIVERS.TIME ? (
                        <span className="dev-prelims-setup__guidance">{basisLabel(line)}</span>
                      ) : null}
                    </td>
                    <td>
                      <input
                        className="input"
                        list="dev-prelims-setup-cost-codes"
                        value={draft.costCodeKey}
                        disabled={!line.selectable || saving}
                        onChange={(event) =>
                          updateDraft(line.templateLineId, 'costCodeKey', event.target.value)
                        }
                        aria-label={`${line.name} cost code`}
                      />
                    </td>
                    <td>
                      {classification.tone === 'unmapped' ? (
                        <span className="dev-prelims-setup__chip">Unmapped</span>
                      ) : null}
                      {classification.tone === 'normal' ? (
                        <span className="dev-prelims-setup__chip dev-prelims-setup__chip--ok">
                          PRELIMS
                        </span>
                      ) : null}
                      {classification.tone === 'warning' ? (
                        <span className="dev-prelims-setup__chip dev-prelims-setup__chip--warn">
                          {classification.message}
                        </span>
                      ) : null}
                      {overlapInfo.overlap ? (
                        <span className="dev-prelims-setup__chip dev-prelims-setup__chip--warn">
                          Overlap
                          {overlapInfo.existingNames.length
                            ? ` with ${overlapInfo.existingNames.join(', ')}`
                            : ''}
                        </span>
                      ) : null}
                      {live.span.state !== 'resolved' &&
                      line.forecastDriver === PRELIMS_DRIVERS.TIME ? (
                        <span className="dev-prelims-setup__chip dev-prelims-setup__chip--warn">
                          {live.span.reasonLabel ||
                            PRELIMS_UNRESOLVED_LABELS[live.span.reason] ||
                            'Unresolved programme'}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {line.forecastDriver === PRELIMS_DRIVERS.TIME ? (
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft.monthlyRate}
                          disabled={!line.selectable || saving}
                          onChange={(event) =>
                            updateDraft(line.templateLineId, 'monthlyRate', event.target.value)
                          }
                          aria-label={`${line.name} monthly rate`}
                          placeholder="£/month"
                        />
                      ) : (
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft.lumpSumAmount}
                          disabled={!line.selectable || saving}
                          onChange={(event) =>
                            updateDraft(line.templateLineId, 'lumpSumAmount', event.target.value)
                          }
                          aria-label={`${line.name} lump-sum amount`}
                          placeholder="£ amount"
                        />
                      )}
                    </td>
                    <td>
                      {forecastUnresolved
                        ? hasAssumptionDisplay(line, draft)
                          ? live.calc.reasonLabel ||
                            PRELIMS_UNRESOLVED_LABELS[live.calc.reason] ||
                            'Unresolved'
                          : '—'
                        : moneyLabel(live.calc.totalForecast)}
                    </td>
                    <td>{readyStateLabel(line, draft, overlapInfo.overlap)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <datalist id="dev-prelims-setup-cost-codes">
        {costCodes.map((row) => {
          const key = row.code || row.costCodeKey || row.key;
          if (!key) return null;
          return (
            <option key={key} value={key}>
              {row.description || row.name || key}
            </option>
          );
        })}
      </datalist>

      <div className="dev-prelims__actions">
        <button
          className="btn btn--primary"
          type="button"
          onClick={handleCreate}
          disabled={saving || loading || readyCount === 0}
        >
          {saving ? 'Creating…' : `Create selected lines (${readyCount})`}
        </button>
        <button className="btn" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function hasAssumptionDisplay(line, draft) {
  if (line.forecastDriver === PRELIMS_DRIVERS.TIME) return String(draft.monthlyRate || '').trim() !== '';
  return String(draft.lumpSumAmount || '').trim() !== '';
}
