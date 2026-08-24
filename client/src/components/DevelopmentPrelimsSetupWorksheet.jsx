import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCostCodeClassification } from '../api/costCodeClassifications';
import {
  applyDevelopmentPrelimsSetup,
  DevelopmentPrelimsApiError,
  previewDevelopmentPrelimsSetup,
} from '../api/developmentPrelimsItems';
import { listPrelimsTemplates } from '../api/prelimsTemplates';
import { listCostCodesForTemplateMapping } from '../admin/prelimsTemplateCostCodes';
import { formatCvrMoney } from '../cvr/cvrHelpers';
import { PRELIMS_DRIVERS, PRELIMS_UNRESOLVED_LABELS } from '../prelims/prelimsConstants';
import {
  applyPayloadFromDrafts,
  classificationForDraft,
  computeOverlap,
  draftAfterDriverChange,
  draftsFromPreview,
  effectiveDriver,
  isLineReady,
  livePreviewCalculation,
  readyStateLabel,
  setupStateChips,
} from '../prelims/prelimsSetupWorksheet';
import PrelimsCostCodePicker from './PrelimsCostCodePicker';
import PrelimsTimeSpanFields from './PrelimsTimeSpanFields';

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
    listCostCodesForTemplateMapping()
      .then((rows) => {
        if (!cancelled) setCostCodes(Array.isArray(rows) ? rows : []);
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
    return preview.lines.filter((line) =>
      isLineReady(line, draftById.get(line.templateLineId), preview.programme)
    ).length;
  }, [preview, draftById]);

  const canonicalCostCodeOptions = useMemo(
    () =>
      (costCodes || [])
        .map((row) => ({
          ...row,
          code: String(row.code || row.value || row.costCodeKey || '').trim(),
          description: row.description || row.element || '',
        }))
        .filter((row) => Boolean(row.code)),
    [costCodes]
  );

  function updateDraft(templateLineId, field, value) {
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.templateLineId !== templateLineId) return draft;
        if (field === 'forecastDriver') {
          const line = preview?.lines?.find((row) => row.templateLineId === templateLineId) || {};
          return draftAfterDriverChange(draft, value, line);
        }
        const next = { ...draft, [field]: value };
        if (field === 'startBasis' && value === 'FIXED_DATE') next.startOffsetMonths = 0;
        if (field === 'endBasis' && value === 'FIXED_DATE') next.endOffsetMonths = 0;
        return next;
      })
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
                <th>Cost code</th>
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
                  forecastDriver: line.forecastDriver,
                  monthlyRate: '',
                  lumpSumAmount: '',
                };
                const driver = effectiveDriver(line, draft);
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
                const timeUnresolvedLabel =
                  driver === PRELIMS_DRIVERS.TIME && live.span.state !== 'resolved'
                    ? live.span.reasonLabel ||
                      PRELIMS_UNRESOLVED_LABELS[live.span.reason] ||
                      'Unresolved programme'
                    : null;
                const stateChips = setupStateChips({
                  classification,
                  overlapInfo,
                  outsideProgramme: Boolean(live.span.outsideProgramme),
                  timeUnresolvedLabel,
                }).filter((chip) => chip.tone !== 'quiet');
                const isTime = driver === PRELIMS_DRIVERS.TIME;
                const showDetail = isTime || stateChips.length > 0;
                return (
                  <Fragment key={line.templateLineId}>
                    <tr className={`dev-prelims-setup__primary ${rowClass}`.trim()}>
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
                      <td>
                        <select
                          className="input"
                          value={driver}
                          disabled={!line.selectable || saving}
                          onChange={(event) =>
                            updateDraft(line.templateLineId, 'forecastDriver', event.target.value)
                          }
                          aria-label={`${line.name} forecast driver`}
                        >
                          <option value={PRELIMS_DRIVERS.TIME}>TIME</option>
                          <option value={PRELIMS_DRIVERS.LUMP_SUM}>LUMP_SUM</option>
                        </select>
                      </td>
                      <td>
                        <PrelimsCostCodePicker
                          name={line.name}
                          options={canonicalCostCodeOptions}
                          value={draft.costCodeKey}
                          disabled={!line.selectable || saving}
                          onChange={(code) => updateDraft(line.templateLineId, 'costCodeKey', code)}
                        />
                      </td>
                      <td>
                        {isTime ? (
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
                    {showDetail ? (
                      <tr
                        className={`dev-prelims-setup__detail ${rowClass}`.trim()}
                        aria-label={`${line.name} line detail`}
                      >
                        <td />
                        <td colSpan={6}>
                          {isTime ? (
                            <PrelimsTimeSpanFields
                              compact
                              disabled={!line.selectable || saving}
                              namePrefix={line.name}
                              startBasis={draft.startBasis}
                              startOffsetMonths={draft.startOffsetMonths}
                              startFixedDate={draft.startFixedDate}
                              endBasis={draft.endBasis}
                              endOffsetMonths={draft.endOffsetMonths}
                              endFixedDate={draft.endFixedDate}
                              resolvedStart={live.span.resolvedStart}
                              resolvedEnd={live.span.resolvedEnd}
                              totalMonths={live.span.totalMonths}
                              outsideProgramme={live.span.outsideProgramme}
                              onChange={(field, value) =>
                                updateDraft(line.templateLineId, field, value)
                              }
                            />
                          ) : null}
                          {stateChips.length ? (
                            <div className="dev-prelims-setup__chips">
                              {stateChips.map((chip) => (
                                <span
                                  key={`${chip.tone}-${chip.text}`}
                                  className={`dev-prelims-setup__chip dev-prelims-setup__chip--${chip.tone}`}
                                >
                                  {chip.text}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

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
  if (effectiveDriver(line, draft) === PRELIMS_DRIVERS.TIME) {
    return String(draft.monthlyRate || '').trim() !== '';
  }
  return String(draft.lumpSumAmount || '').trim() !== '';
}
