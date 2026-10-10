import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCostCodeClassification } from '../api/costCodeClassifications';
import { getDevelopmentBudget } from '../api/developmentBudget';
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
import { formatReportingPeriod } from '../cvr/cvrReportingMonth';
import { PRELIMS_DRIVERS, PRELIMS_UNRESOLVED_LABELS } from '../prelims/prelimsConstants';
import {
  applyPayloadFromDrafts,
  classificationForDraft,
  displayPrelimIdentity,
  draftAfterDriverChange,
  draftsFromPreview,
  effectiveDriver,
  groupSetupLines,
  isLineSaveable,
  livePreviewCalculation,
  mergeDraftsAfterIncrementalAdd,
  mappingProvenance,
  readyStateLabel,
  setupDraftsAreDirty,
  setupProgress,
  setupStateChips,
  summarizeSetupGroup,
} from '../prelims/prelimsSetupWorksheet';
import { useUnsavedChanges } from '../navigation/UnsavedChangesContext.js';
import CommercialHeadCostCodePicker from './CommercialHeadCostCodePicker';
import PrelimsTimeSpanFields from './PrelimsTimeSpanFields';

function moneyLabel(value) {
  if (value == null) return '—';
  return formatCvrMoney(value);
}

function matrixStatusLabel(line, draft, calculation) {
  if (!line.enabled) return 'Disabled company line';
  if (line.alreadyApplied) {
    return calculation?.state === 'resolved' && calculation.totalForecast === 0
      ? 'Already on this development · £0 forecast'
      : 'Already on this development';
  }
  if (calculation?.state === 'resolved' && calculation.totalForecast === 0) {
    return draft.selected ? 'Selected · £0 forecast' : 'Available · £0 forecast';
  }
  const state = readyStateLabel(line, draft);
  if (state === 'Not selected') return 'Available · ready';
  return state;
}

export default function DevelopmentPrelimsSetupWorksheet({
  developmentId,
  persistedItems = [],
  onCancel,
  onApplied,
  onSetUpCompanyTemplate = null,
}) {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [preview, setPreview] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [baselineDrafts, setBaselineDrafts] = useState([]);
  const [classifications, setClassifications] = useState({});
  const [costCodes, setCostCodes] = useState([]);
  const [commercialStructure, setCommercialStructure] = useState(null);
  const [budget, setBudget] = useState(null);
  const [budgetLoading, setBudgetLoading] = useState(true);
  const [budgetError, setBudgetError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingMappings, setEditingMappings] = useState(() => new Set());
  const [mappingEditOriginals, setMappingEditOriginals] = useState({});
  const [expandedLines, setExpandedLines] = useState(() => new Set());
  const creatingRef = useRef(false);
  const { registerUnsavedChanges, requestNavigation } = useUnsavedChanges();

  const loadBudget = useCallback(async () => {
    setBudgetLoading(true);
    setBudgetError('');
    try {
      setBudget(await getDevelopmentBudget(developmentId));
    } catch (err) {
      setBudget(null);
      setBudgetError(err.message || 'Development Budget is temporarily unavailable.');
    } finally {
      setBudgetLoading(false);
    }
  }, [developmentId]);

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
    loadBudget();
  }, [loadBudget]);

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

  const persistedById = useMemo(
    () => new Map(persistedItems.map((item) => [item.id, item])),
    [persistedItems]
  );
  const displayDrafts = useMemo(
    () =>
      (preview?.lines || []).map((line) => {
        const draft = draftById.get(line.templateLineId);
        const item = line.alreadyAppliedItemId
          ? persistedById.get(line.alreadyAppliedItemId)
          : null;
        if (!line.alreadyApplied || !item) return draft;
        return {
          ...draft,
          costCodeKey: item.costCodeKey,
          forecastDriver: item.forecastDriver,
          monthlyRate: item.monthlyRate == null ? '' : String(item.monthlyRate),
          lumpSumAmount: item.lumpSumAmount == null ? '' : String(item.lumpSumAmount),
          startBasis: item.startBasis,
          startOffsetMonths: item.startOffsetMonths ?? 0,
          startFixedDate: item.startFixedDate || '',
          endBasis: item.endBasis,
          endOffsetMonths: item.endOffsetMonths ?? 0,
          endFixedDate: item.endFixedDate || '',
        };
      })
      .filter(Boolean),
    [preview, draftById, persistedById]
  );
  const displayDraftById = useMemo(
    () => new Map(displayDrafts.map((draft) => [draft.templateLineId, draft])),
    [displayDrafts]
  );

  const saveableCount = useMemo(() => {
    if (!preview) return 0;
    return preview.lines.filter((line) =>
      isLineSaveable(line, draftById.get(line.templateLineId))
    ).length;
  }, [preview, draftById]);

  const activeGroups = useMemo(
    () => groupSetupLines(preview?.lines || [], displayDrafts),
    [preview, displayDrafts]
  );
  const activeLines = useMemo(() => activeGroups.flatMap((group) => group.lines), [activeGroups]);
  const groupByLineId = useMemo(() => {
    const result = new Map();
    activeGroups.forEach((group) => group.lines.forEach((line) => result.set(line.templateLineId, group)));
    return result;
  }, [activeGroups]);
  const budgetByCostCodeId = useMemo(() => {
    const result = new Map();
    for (const row of budget?.perCostCode || []) {
      const key = String(row.costCodeId || '').trim();
      if (key) result.set(key, row);
    }
    return result;
  }, [budget]);

  const progress = useMemo(() => setupProgress(preview, drafts), [preview, drafts]);
  const alreadyAppliedCount = useMemo(
    () => (preview?.lines || []).filter((line) => line.alreadyApplied).length,
    [preview]
  );
  const availableCount = useMemo(
    () => (preview?.lines || []).filter((line) => line.enabled && !line.alreadyApplied).length,
    [preview]
  );
  const previewMonthLabel = preview?.reportingMonth
    ? preview.reportingMonthSource === 'site-start-forecast-as-at'
      ? `Forecast as at: ${formatReportingPeriod(preview.reportingMonth)}`
      : `CVR reporting month: ${formatReportingPeriod(preview.reportingMonth)}`
    : 'No reporting month';
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

  function toggleLineDetail(templateLineId) {
    setExpandedLines((current) => {
      const next = new Set(current);
      if (next.has(templateLineId)) next.delete(templateLineId);
      else next.add(templateLineId);
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
      setError('Select configured lines and enter a Cost Code plus site assumption before adding.');
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
        {onSetUpCompanyTemplate ? (
          <button className="btn btn--primary" type="button" onClick={onSetUpCompanyTemplate}>
            Set up Company Prelims Template
          </button>
        ) : null}
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
          Enter site-specific assumptions against the company template, then add selected configured
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
            ? `${preview.lines.length} template lines · ${alreadyAppliedCount} already on this development · ${availableCount} available to add · ${previewMonthLabel}`
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
          Current setup: {progress.selected} selected · {progress.configured} new configured · {progress.resolved} new forecast resolved ·{' '}
          {progress.needsAttention} needs attention
        </p>
      ) : null}
      {preview && !preview.reportingMonth ? (
        <p className="dev-workspace__section-lead">
          Total Forecast is available now. As-at phasing will become available when an effective
          forecast month exists.
        </p>
      ) : null}
      {preview && !preview.programme?.siteStart && !preview.programme?.finalCompletion ? (
        <p className="dev-workspace__section-lead">
          Programme dates are not available. Time-based assumptions can be saved now and their
          forecasts will resolve automatically when the programme is configured.
        </p>
      ) : null}
      {budgetError ? (
        <p className="dev-workspace__section-lead" role="status">
          Budget context unavailable. Prelims setup remains available.{' '}
          <button className="btn" type="button" onClick={loadBudget}>Retry budget</button>
        </p>
      ) : null}

      {preview ? (
        <div className="dev-prelims-setup__table-wrap">
          <table className="dev-prelims-setup__table">
            <thead>
              <tr>
                <th>Cost code</th>
                <th>Prelim item</th>
                <th>Driver</th>
                <th>Start</th>
                <th>Offset</th>
                <th>End</th>
                <th>Offset</th>
                <th>Months</th>
                <th>Rate / amount</th>
                <th>Forecast</th>
                <th>Status</th>
                <th><span className="visually-hidden">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {activeLines.map((line, lineIndex) => {
                const draft = displayDraftById.get(line.templateLineId) || {
                  templateLineId: line.templateLineId,
                  selected: false,
                  costCodeKey: '',
                  forecastDriver: line.forecastDriver,
                  monthlyRate: '',
                  lumpSumAmount: '',
                };
                const driver = effectiveDriver(line, draft);
                const live = livePreviewCalculation(
                  line,
                  draft,
                  preview.programme,
                  preview.reportingMonth
                );
                const classification = classificationForDraft(
                  draft,
                  classifications[String(draft.costCodeKey || '').trim()]?.semanticGroup,
                  { costCodes, structure: commercialStructure }
                );
                const rowClass = [
                  !line.enabled ? 'dev-prelims-setup__row--disabled' : '',
                  line.alreadyApplied ? 'dev-prelims-setup__row--applied' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                const forecastUnresolved = live.calc.state !== 'resolved';
                const timeUnresolvedLabel =
                  driver === PRELIMS_DRIVERS.TIME && live.span.state !== 'resolved'
                    && live.span.reason !== 'MISSING_PROGRAMME'
                    ? live.span.reasonLabel ||
                      PRELIMS_UNRESOLVED_LABELS[live.span.reason] ||
                      'Unresolved programme'
                    : null;
                const stateChips = setupStateChips({
                  classification,
                  outsideProgramme: Boolean(live.span.outsideProgramme),
                  timeUnresolvedLabel,
                }).filter((chip) => chip.tone !== 'quiet');
                const isTime = driver === PRELIMS_DRIVERS.TIME;
                const provenance = mappingProvenance(line, draft);
                const identity = displayPrelimIdentity(line);
                const editingMapping = editingMappings.has(line.templateLineId);
                const searchFirst = provenance.state === 'company_unmapped';
                const showDetail = expandedLines.has(line.templateLineId);
                const group = groupByLineId.get(line.templateLineId);
                const previousGroup = lineIndex ? groupByLineId.get(activeLines[lineIndex - 1].templateLineId) : null;
                const firstInGroup = previousGroup?.key !== group?.key;
                const groupSummary = firstInGroup
                  ? summarizeSetupGroup(group, drafts, preview.programme, preview.reportingMonth)
                  : null;
                const groupCostCodeId = canonicalCostCodeOptions.find(
                  (row) => row.code === group?.costCodeKey
                )?.id;
                const budgetPosition = groupCostCodeId ? budgetByCostCodeId.get(groupCostCodeId) : null;
                const currentBudget = budgetPosition?.currentBudget ?? null;
                const openingBudget = budgetPosition?.originalBudget ?? budgetPosition?.openingBudget ?? null;
                return (
                  <Fragment key={line.templateLineId}>
                    {firstInGroup ? (
                      <tr className="dev-prelims-setup__group" aria-label={`${group.costCodeKey || 'Unmapped'} Cost Code group`}>
                        <td colSpan={12}>
                          <div className="dev-prelims-setup__group-summary">
                            <div>
                              <strong>{group.costCodeKey ? costCodeLabel(group.costCodeKey) : 'Cost Code not selected'}</strong>
                              {group.lines.length > 1 ? <span>{group.lines.length} lines share this Cost Code</span> : null}
                            </div>
                            <div>
                              <span>Current Budget</span>
                              <strong>{budgetLoading ? 'Loading…' : budgetError ? 'Unavailable' : moneyLabel(currentBudget ?? 0)}</strong>
                              {openingBudget != null && currentBudget != null && openingBudget !== currentBudget ? (
                                <small>Opening {moneyLabel(openingBudget)} · Movement {moneyLabel(currentBudget - openingBudget)}</small>
                              ) : null}
                            </div>
                            <div>
                              <span>Configured forecast</span>
                              <strong>{groupSummary.forecast == null ? (groupSummary.configuredCount ? 'Pending programme' : '—') : moneyLabel(groupSummary.forecast)}</strong>
                              {groupSummary.forecast != null && currentBudget != null ? (
                                <small>Variance {moneyLabel(groupSummary.forecast - currentBudget)}</small>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    <tr className={`dev-prelims-setup__primary ${rowClass}`.trim()}>
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
                        <small className={`dev-prelims-setup__mapping-compact dev-prelims-setup__mapping-source--${provenance.state}`}>
                          {provenance.label}
                        </small>
                      </td>
                      <td data-label="Prelim item">
                        <label className="dev-prelims-setup__line-name">
                          <input
                            type="checkbox"
                            checked={Boolean(draft.selected) && line.selectable}
                            disabled={!line.selectable || saving}
                            onChange={(event) =>
                              updateDraft(line.templateLineId, 'selected', event.target.checked)
                            }
                            aria-label={`Select ${line.name}`}
                          />
                          <span><strong>{identity.name}</strong>{line.category ? <small>{line.category}</small> : null}</span>
                        </label>
                      </td>
                      <td data-label="Driver">
                        <select className="input" value={driver} disabled={!line.selectable || saving}
                          onChange={(event) => updateDraft(line.templateLineId, 'forecastDriver', event.target.value)}
                          aria-label={`${line.name} forecast driver`}>
                          <option value={PRELIMS_DRIVERS.TIME}>Monthly</option>
                          <option value={PRELIMS_DRIVERS.LUMP_SUM}>Lump sum</option>
                        </select>
                      </td>
                      <td data-label="Start">
                        {isTime ? <select className="input" value={draft.startBasis || 'SITE_START'} disabled={!line.selectable || saving}
                          onChange={(event) => updateDraft(line.templateLineId, 'startBasis', event.target.value)} aria-label={`${line.name} start basis`}>
                          <option value="SITE_START">Site start</option><option value="FIRST_COMPLETION">First completion</option>
                          <option value="FINAL_COMPLETION">Final completion</option><option value="FIXED_DATE">Fixed date</option>
                        </select> : '—'}
                      </td>
                      <td data-label="Start offset">
                        {isTime && draft.startBasis !== 'FIXED_DATE' ? <input className="input" type="number" min="-60" max="60" step="1"
                          value={draft.startOffsetMonths ?? 0} disabled={!line.selectable || saving}
                          onChange={(event) => updateDraft(line.templateLineId, 'startOffsetMonths', event.target.value)} aria-label={`${line.name} start offset months`} /> : '—'}
                      </td>
                      <td data-label="End">
                        {isTime ? <select className="input" value={draft.endBasis || 'FINAL_COMPLETION'} disabled={!line.selectable || saving}
                          onChange={(event) => updateDraft(line.templateLineId, 'endBasis', event.target.value)} aria-label={`${line.name} end basis`}>
                          <option value="SITE_START">Site start</option><option value="FIRST_COMPLETION">First completion</option>
                          <option value="FINAL_COMPLETION">Final completion</option><option value="FIXED_DATE">Fixed date</option>
                        </select> : '—'}
                      </td>
                      <td data-label="End offset">
                        {isTime && draft.endBasis !== 'FIXED_DATE' ? <input className="input" type="number" min="-60" max="60" step="1"
                          value={draft.endOffsetMonths ?? 0} disabled={!line.selectable || saving}
                          onChange={(event) => updateDraft(line.templateLineId, 'endOffsetMonths', event.target.value)} aria-label={`${line.name} end offset months`} /> : '—'}
                      </td>
                      <td data-label="Months">{isTime && live.span.totalMonths != null ? `${live.span.totalMonths} months` : '—'}</td>
                      <td data-label="Rate / amount">
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
                        {!line.alreadyApplied &&
                        ((isTime && line.monthlyRate != null) ||
                          (!isTime && line.lumpSumAmount != null)) ? (
                          <small className="dev-prelims-setup__default-source">Company default</small>
                        ) : null}
                      </td>
                      <td data-label="Forecast">
                        {forecastUnresolved
                           ? hasAssumptionDisplay(line, draft)
                             && live.calc.reason === 'MISSING_PROGRAMME'
                             ? 'Pending programme'
                             : hasAssumptionDisplay(line, draft)
                            ? live.calc.reasonLabel ||
                              PRELIMS_UNRESOLVED_LABELS[live.calc.reason] ||
                              'Unresolved'
                            : '—'
                          : moneyLabel(live.calc.totalForecast)}
                      </td>
                      <td data-label="Status">{matrixStatusLabel(line, draft, live.calc)}</td>
                      <td data-label="Details">
                        <button className="dev-prelims-setup__detail-toggle" type="button"
                          aria-expanded={showDetail} aria-label={`${showDetail ? 'Hide' : 'Show'} ${line.name} details`}
                          onClick={() => toggleLineDetail(line.templateLineId)}>⌄</button>
                      </td>
                    </tr>
                    {showDetail ? (
                      <tr
                        className={`dev-prelims-setup__detail ${rowClass}`.trim()}
                        aria-label={`${line.name} line detail`}
                      >
                        <td colSpan={12}>
                          <div className="dev-prelims-setup__detail-grid">
                            <div><strong>{identity.name}</strong><p>{identity.guidance || 'No additional description.'}</p></div>
                            <div>
                              <strong>{provenance.label}</strong><p>{provenance.detail}</p>
                              {!searchFirst && !line.alreadyApplied ? <div className="dev-prelims-setup__mapping-actions">
                                {editingMapping ? <button className="btn" type="button" onClick={() => cancelMappingEdit(line)}>Cancel</button>
                                  : <button className="btn" type="button" onClick={() => beginMappingEdit(line, draft)}>Change for this development</button>}
                                {provenance.state === 'development_override' ? <button className="btn" type="button" onClick={() => revertToCompanyMapping(line)}>Revert to company mapping</button> : null}
                              </div> : null}
                              {line.alreadyApplied ? <p>Amend this saved line from the Site Prelims schedule; setup will not overwrite it.</p> : null}
                            </div>
                          </div>
                          {isTime && (draft.startBasis === 'FIXED_DATE' || draft.endBasis === 'FIXED_DATE') ? (
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
                          {isTime ? <p className="dev-prelims-setup__phasing">Resolved {live.span.resolvedStart || '—'} to {live.span.resolvedEnd || '—'} · Forecast to date {moneyLabel(live.calc.forecastToDate)} · Remaining {moneyLabel(live.calc.forecastToComplete)}</p> : null}
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

      {preview?.lines.some((line) => !line.enabled) ? (
        <section className="dev-prelims-setup__disabled" aria-label="Disabled company Prelims lines">
          <h4>Not instantiated from company template</h4>
          <ul>
            {preview.lines.filter((line) => !line.enabled).map((line) => (
              <li key={line.templateLineId}>{displayPrelimIdentity(line).name}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="dev-prelims__actions">
        <button
          className="btn btn--primary"
          type="button"
          onClick={handleCreate}
          disabled={saving || loading || saveableCount === 0}
        >
          {saving
            ? 'Adding…'
            : `Add ${saveableCount} configured ${saveableCount === 1 ? 'line' : 'lines'} to Site Prelims`}
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
