import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCostCodeClassification } from '../api/costCodeClassifications';
import {
  applyDevelopmentPrelimsSetup,
  DevelopmentPrelimsApiError,
  previewDevelopmentPrelimsSetup,
} from '../api/developmentPrelimsItems';
import { listPrelimsTemplates } from '../api/prelimsTemplates';
import { listCostCodesForTemplateMapping } from '../admin/prelimsTemplateCostCodes';
import { loadCommercialStructure } from '../admin/commercialStructureService';
import { mappingOptionPrimaryLabel } from '../admin/prelimsTemplateMapping';
import { formatCvrMoney } from '../cvr/cvrHelpers';
import { PRELIMS_DRIVERS, PRELIMS_UNRESOLVED_LABELS } from '../prelims/prelimsConstants';
import {
  applyPayloadFromDrafts,
  classificationForDraft,
  computeOverlap,
  displayPrelimIdentity,
  draftAfterDriverChange,
  draftsFromPreview,
  effectiveDriver,
  isLineReady,
  livePreviewCalculation,
  mergeDraftsAfterIncrementalAdd,
  mappingProvenance,
  readyStateLabel,
  setupDraftsAreDirty,
  setupProgress,
  setupStateChips,
} from '../prelims/prelimsSetupWorksheet';
import { useUnsavedChanges } from '../navigation/UnsavedChangesContext.js';
import CommercialHeadCostCodePicker from './CommercialHeadCostCodePicker';
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
  const [baselineDrafts, setBaselineDrafts] = useState([]);
  const [classifications, setClassifications] = useState({});
  const [costCodes, setCostCodes] = useState([]);
  const [commercialStructure, setCommercialStructure] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingMappings, setEditingMappings] = useState(() => new Set());
  const [mappingEditOriginals, setMappingEditOriginals] = useState({});
  const creatingRef = useRef(false);
  const { registerUnsavedChanges, requestNavigation } = useUnsavedChanges();

  const loadPreview = useCallback(
    async (nextTemplateId, { preserveDrafts = null } = {}) => {
      setLoading(true);
      setError('');
      try {
        const next = await previewDevelopmentPrelimsSetup(developmentId, {
          templateId: nextTemplateId || undefined,
        });
        setPreview(next);
        setTemplateId(next.template.id);
        const freshDrafts = draftsFromPreview(next);
        setBaselineDrafts(freshDrafts);
        setDrafts(
          preserveDrafts
            ? mergeDraftsAfterIncrementalAdd(next, preserveDrafts)
            : freshDrafts
        );
      } catch (err) {
        setError(err.message || 'Could not load the Prelims setup worksheet.');
        setPreview(null);
        setDrafts([]);
        setBaselineDrafts([]);
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
    let cancelled = false;
    loadCommercialStructure().then((value) => { if (!cancelled) setCommercialStructure(value); }).catch(() => { if (!cancelled) setCommercialStructure(null); });
    return () => { cancelled = true; };
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

  const progress = useMemo(() => setupProgress(preview, drafts), [preview, drafts]);
  const dirty = useMemo(
    () => setupDraftsAreDirty(drafts, baselineDrafts),
    [drafts, baselineDrafts]
  );

  useEffect(() => {
    if (!dirty) return undefined;
    return registerUnsavedChanges({
      title: 'Unsaved Prelims setup',
      message:
        "You have setup changes that haven't been added to Site Prelims. Leaving now will discard them.",
    });
  }, [dirty, registerUnsavedChanges]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

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

  function setMappingEditing(templateLineId, editing) {
    setEditingMappings((current) => {
      const next = new Set(current);
      if (editing) next.add(templateLineId);
      else next.delete(templateLineId);
      return next;
    });
  }

  function beginMappingEdit(line, draft) {
    setMappingEditOriginals((current) => ({
      ...current,
      [line.templateLineId]: draft.costCodeKey || '',
    }));
    setMappingEditing(line.templateLineId, true);
  }

  function cancelMappingEdit(line) {
    updateDraft(
      line.templateLineId,
      'costCodeKey',
      mappingEditOriginals[line.templateLineId] ?? line.costCodeKey ?? ''
    );
    setMappingEditing(line.templateLineId, false);
  }

  function revertToCompanyMapping(line) {
    updateDraft(line.templateLineId, 'costCodeKey', line.costCodeKey || '');
    setMappingEditing(line.templateLineId, false);
  }

  function costCodeLabel(code) {
    const option = canonicalCostCodeOptions.find((row) => row.code === code);
    return option ? mappingOptionPrimaryLabel(option) : code;
  }

  async function handleCreate() {
    if (!preview || creatingRef.current || saving) return;
    const payload = applyPayloadFromDrafts(preview, drafts);
    if (!payload.lines.length) {
      setError('Select ready lines and enter a cost code plus site assumption before adding.');
      return;
    }
    creatingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await applyDevelopmentPrelimsSetup(developmentId, payload);
      await loadPreview(templateId, { preserveDrafts: drafts });
      if (typeof onApplied === 'function') await onApplied(result);
    } catch (err) {
      const message =
        err instanceof DevelopmentPrelimsApiError && err.status === 409
          ? 'The company template changed. Reload the worksheet and try again.'
          : err.message || 'Could not add selected Prelims lines.';
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
        <button className="btn" type="button" onClick={() => requestNavigation(onCancel)}>
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
          Enter site-specific assumptions against the company template, then add selected ready
          lines to Site Prelims. Adds these assumptions to the Development Prelims proposal. This
          does not change the CVR. Preview-only cost-code mapping does not change the company
          template.
        </p>
      </header>

      <div className="dev-prelims-setup__toolbar">
        <label>
          Company template
          <select
            className="input"
            value={templateId}
            onChange={(event) => {
              const nextTemplateId = event.target.value;
              requestNavigation(() => loadPreview(nextTemplateId));
            }}
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
        <p className="dev-prelims-setup__progress" role="status">
          {progress.selected} selected · {progress.ready} ready · {progress.needsAttention} needs
          attention · {moneyLabel(progress.readyForecast)} ready forecast
          {progress.unresolved ? ` · ${progress.unresolved} unresolved` : ''}
        </p>
      ) : null}

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
                const provenance = mappingProvenance(line, draft);
                const identity = displayPrelimIdentity(line);
                const editingMapping = editingMappings.has(line.templateLineId);
                const searchFirst = provenance.state === 'company_unmapped';
                const showDetail = isTime || stateChips.length > 0;
                return (
                  <Fragment key={line.templateLineId}>
                    <tr className={`dev-prelims-setup__primary ${rowClass}`.trim()}>
                      <td data-label="Select">
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
                      <td data-label="Prelim">
                        <strong>{identity.name}</strong>
                        {identity.guidance ? (
                          <span className="dev-prelims-setup__guidance">{identity.guidance}</span>
                        ) : null}
                      </td>
                      <td data-label="Driver">
                        <select
                          className="input"
                          value={driver}
                          disabled={!line.selectable || saving}
                          onChange={(event) =>
                            updateDraft(line.templateLineId, 'forecastDriver', event.target.value)
                          }
                          aria-label={`${line.name} forecast driver`}
                        >
                          <option value={PRELIMS_DRIVERS.TIME}>Time based</option>
                          <option value={PRELIMS_DRIVERS.LUMP_SUM}>Lump sum</option>
                        </select>
                      </td>
                      <td data-label="Cost code">
                        {searchFirst || editingMapping ? (
                          <CommercialHeadCostCodePicker
                            category="PRELIMINARIES"
                            structure={commercialStructure}
                            codes={canonicalCostCodeOptions}
                            identity="code"
                            name={identity.name}
                            valueCode={draft.costCodeKey}
                            disabled={!line.selectable || saving}
                            onChange={(code) =>
                              updateDraft(line.templateLineId, 'costCodeKey', code)
                            }
                          />
                        ) : (
                          <p className="dev-prelims-setup__mapping-value">
                            {costCodeLabel(draft.costCodeKey)}
                          </p>
                        )}
                        <span
                          className={`dev-prelims-setup__mapping-source dev-prelims-setup__mapping-source--${provenance.state}`}
                        >
                          <strong>{provenance.label}</strong>
                          <span>{provenance.detail}</span>
                          {provenance.state === 'company_unmapped' ? (
                            <span>
                              Add your ready lines to Site Prelims before leaving to complete
                              reusable company mapping in Administration.
                            </span>
                          ) : null}
                        </span>
                        {!searchFirst ? (
                          <div className="dev-prelims-setup__mapping-actions">
                            {editingMapping ? (
                              <button
                                className="btn"
                                type="button"
                                onClick={() => cancelMappingEdit(line)}
                              >
                                Cancel
                              </button>
                            ) : (
                              <button
                                className="btn"
                                type="button"
                                onClick={() => beginMappingEdit(line, draft)}
                              >
                                {provenance.state === 'development_override'
                                  ? 'Change'
                                  : 'Change for this development'}
                              </button>
                            )}
                            {provenance.state === 'development_override' ? (
                              <button
                                className="btn"
                                type="button"
                                onClick={() => revertToCompanyMapping(line)}
                              >
                                Revert to company mapping
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                      <td data-label="Assumption">
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
                      <td data-label="Forecast">
                        {forecastUnresolved
                          ? hasAssumptionDisplay(line, draft)
                            ? live.calc.reasonLabel ||
                              PRELIMS_UNRESOLVED_LABELS[live.calc.reason] ||
                              'Unresolved'
                            : '—'
                          : moneyLabel(live.calc.totalForecast)}
                      </td>
                      <td data-label="Ready">{readyStateLabel(line, draft, overlapInfo.overlap)}</td>
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
          {saving
            ? 'Adding…'
            : `Add ${readyCount} ready ${readyCount === 1 ? 'line' : 'lines'} to Site Prelims`}
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => requestNavigation(onCancel)}
          disabled={saving}
        >
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
