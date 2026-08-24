import { useCallback, useEffect, useMemo, useState } from 'react';
import { listCostCodes } from '../api';
import { getCostCodeClassification } from '../api/costCodeClassifications';
import {
  createDevelopmentPrelimsItem,
  DevelopmentPrelimsApiError,
  listDevelopmentPrelimsItems,
  updateDevelopmentPrelimsItem,
} from '../api/developmentPrelimsItems';
import { formatCvrMoney } from '../cvr/cvrHelpers';
import {
  PRELIMS_DRIVERS,
  PRELIMS_STATUSES,
  PRELIMS_UNRESOLVED_LABELS,
  TIME_BASES,
} from '../prelims/prelimsConstants';
import { resolveTimeSpan, suggestedPrelimsDriver } from '../prelims/prelimsForecastEngine';
import DevelopmentPrelimsSetupWorksheet from './DevelopmentPrelimsSetupWorksheet';
import PrelimsTimeSpanFields from './PrelimsTimeSpanFields';
import { coerceOffsetMonths } from '../programme/programmeCalendar';

const EMPTY_ADD_FORM = {
  id: null,
  version: 0,
  costCodeKey: '',
  name: '',
  forecastDriver: PRELIMS_DRIVERS.TIME,
  status: PRELIMS_STATUSES.ACTIVE,
  monthlyRate: '1000',
  startBasis: TIME_BASES.SITE_START,
  startOffsetMonths: 0,
  startFixedDate: '',
  endBasis: TIME_BASES.FINAL_COMPLETION,
  endOffsetMonths: 0,
  endFixedDate: '',
  lumpSumAmount: '',
};

function blankAddForm() {
  return { ...EMPTY_ADD_FORM, id: null, version: 0 };
}

function moneyLabel(value) {
  if (value == null) return 'Unresolved';
  return formatCvrMoney(value);
}

function unresolvedLineLabel(count) {
  if (!count || count <= 0) return null;
  return count === 1 ? '1 unresolved line' : `${count} unresolved lines`;
}

function formatResolvedProposalText(activeProposal, unresolvedCount = 0) {
  const amount =
    activeProposal == null && unresolvedCount > 0
      ? '—'
      : activeProposal == null
        ? 'Unresolved'
        : moneyLabel(activeProposal);
  const unresolved = unresolvedLineLabel(unresolvedCount);
  return unresolved ? `Resolved proposal ${amount} · ${unresolved}` : `Resolved proposal ${amount}`;
}

function groupByCostCode(items = []) {
  const groups = [];
  const index = new Map();
  for (const item of items) {
    const key = item.costCodeKey || '(blank)';
    if (!index.has(key)) {
      index.set(key, groups.length);
      groups.push({ costCodeKey: key, items: [] });
    }
    groups[index.get(key)].items.push(item);
  }
  return groups;
}

function LineCalc({ item }) {
  const calc = item.calculation || {};
  const unresolved = calc.state !== 'resolved';
  if (item.forecastDriver === PRELIMS_DRIVERS.LUMP_SUM) {
    return (
      <dl className="dev-prelims__calc">
        <div>
          <dt>Assumption</dt>
          <dd>{moneyLabel(calc.assumptionAmount)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{item.status}</dd>
        </div>
        <div>
          <dt>Active proposal</dt>
          <dd>{calc.includedInActiveProposal ? moneyLabel(calc.totalForecast) : 'Excluded'}</dd>
        </div>
        <div>
          <dt>Remaining exposure</dt>
          <dd>{moneyLabel(calc.remainingExposure)}</dd>
        </div>
      </dl>
    );
  }
  return (
    <dl className={`dev-prelims__calc${unresolved ? ' dev-prelims__calc--unresolved' : ''}`}>
      <div>
        <dt>Resolved start</dt>
        <dd>{calc.resolvedStart || '—'}</dd>
      </div>
      <div>
        <dt>Resolved end</dt>
        <dd>{calc.resolvedEnd || '—'}</dd>
      </div>
      <div>
        <dt>Total months</dt>
        <dd>{calc.totalMonths ?? '—'}</dd>
      </div>
      <div>
        <dt>Elapsed months</dt>
        <dd>{calc.elapsedMonths ?? '—'}</dd>
      </div>
      <div>
        <dt>Remaining months</dt>
        <dd>{calc.remainingMonths ?? '—'}</dd>
      </div>
      <div>
        <dt>Total forecast</dt>
        <dd>{unresolved ? 'Unresolved' : moneyLabel(calc.totalForecast)}</dd>
      </div>
      <div>
        <dt>Forecast to date</dt>
        <dd>{unresolved ? 'Unresolved' : moneyLabel(calc.forecastToDate)}</dd>
      </div>
      <div>
        <dt>Forecast to complete</dt>
        <dd>{unresolved ? 'Unresolved' : moneyLabel(calc.forecastToComplete)}</dd>
      </div>
      {unresolved ? (
        <div className="dev-prelims__calc-reason">
          <dt>Unresolved</dt>
          <dd>{calc.reasonLabel || PRELIMS_UNRESOLVED_LABELS[calc.reason] || calc.reason}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export default function DevelopmentPrelimsWorkspace({ developmentId }) {
  const [collection, setCollection] = useState(null);
  const [costCodes, setCostCodes] = useState([]);
  const [mode, setMode] = useState('add');
  const [form, setForm] = useState(blankAddForm);
  const [classificationHint, setClassificationHint] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [workspaceView, setWorkspaceView] = useState('lines');
  const isEditMode = mode === 'edit' && Boolean(form.id);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listDevelopmentPrelimsItems(developmentId);
      setCollection(next);
    } catch (err) {
      setError(err.message || 'Could not load Prelims lines.');
    } finally {
      setLoading(false);
    }
  }, [developmentId]);

  useEffect(() => {
    load();
  }, [load]);

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
    const key = form.costCodeKey.trim();
    if (!key || isEditMode) {
      if (isEditMode) setClassificationHint('');
      return undefined;
    }
    let cancelled = false;
    getCostCodeClassification(key)
      .then((row) => {
        if (cancelled) return;
        const suggested = suggestedPrelimsDriver(row?.forecastDriver);
        if (suggested) {
          setClassificationHint(
            `Classification suggests ${suggested}. This is a create-time hint only.`
          );
          setForm((current) =>
            current.id || mode === 'edit' ? current : { ...current, forecastDriver: suggested }
          );
        } else {
          setClassificationHint(
            'Classification default is Standard CVR. Choose TIME or LUMP_SUM for this line. Standard CVR stays on the CVR.'
          );
        }
      })
      .catch(() => {
        if (!cancelled) setClassificationHint('');
      });
    return () => {
      cancelled = true;
    };
  }, [form.costCodeKey, isEditMode, mode]);

  const grouped = useMemo(() => groupByCostCode(collection?.items || []), [collection]);
  const summary = collection?.summary;
  const formTimeSpan = useMemo(() => {
    if (form.forecastDriver !== PRELIMS_DRIVERS.TIME) {
      return { resolvedStart: null, resolvedEnd: null, totalMonths: null, outsideProgramme: false };
    }
    return resolveTimeSpan(
      {
        forecastDriver: PRELIMS_DRIVERS.TIME,
        startBasis: form.startBasis,
        startOffsetMonths: form.startOffsetMonths,
        startFixedDate: form.startFixedDate,
        endBasis: form.endBasis,
        endOffsetMonths: form.endOffsetMonths,
        endFixedDate: form.endFixedDate,
      },
      collection?.programme
    );
  }, [form, collection?.programme]);

  function updateField(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === 'startBasis' && value === TIME_BASES.FIXED_DATE) next.startOffsetMonths = 0;
      if (field === 'endBasis' && value === TIME_BASES.FIXED_DATE) next.endOffsetMonths = 0;
      return next;
    });
  }

  function enterAddMode() {
    setMode('add');
    setForm(blankAddForm());
    setClassificationHint('');
    setError('');
  }

  function startEdit(item) {
    setMode('edit');
    setClassificationHint('');
    setForm({
      id: item.id,
      version: item.version,
      costCodeKey: item.costCodeKey,
      name: item.name,
      forecastDriver: item.forecastDriver,
      status: item.status,
      monthlyRate: item.monthlyRate == null ? '' : String(item.monthlyRate),
      startBasis: item.startBasis || TIME_BASES.SITE_START,
      startOffsetMonths: item.startOffsetMonths ?? 0,
      startFixedDate: item.startFixedDate || '',
      endBasis: item.endBasis || TIME_BASES.FINAL_COMPLETION,
      endOffsetMonths: item.endOffsetMonths ?? 0,
      endFixedDate: item.endFixedDate || '',
      lumpSumAmount: item.lumpSumAmount == null ? '' : String(item.lumpSumAmount),
    });
    setError('');
  }

  async function handleSave(event) {
    event.preventDefault();
    const saveIsEdit = mode === 'edit' && Boolean(form.id);
    const editingId = saveIsEdit ? form.id : null;
    setSaving(true);
    setError('');
    const payload = {
      version: saveIsEdit ? form.version : 0,
      costCodeKey: form.costCodeKey,
      name: form.name,
      forecastDriver: form.forecastDriver,
      status: form.status,
      monthlyRate: form.forecastDriver === PRELIMS_DRIVERS.TIME ? Number(form.monthlyRate) : null,
      startBasis: form.forecastDriver === PRELIMS_DRIVERS.TIME ? form.startBasis : null,
      startOffsetMonths:
        form.forecastDriver === PRELIMS_DRIVERS.TIME ? coerceOffsetMonths(form.startOffsetMonths) : 0,
      startFixedDate:
        form.forecastDriver === PRELIMS_DRIVERS.TIME && form.startBasis === TIME_BASES.FIXED_DATE
          ? form.startFixedDate
          : null,
      endBasis: form.forecastDriver === PRELIMS_DRIVERS.TIME ? form.endBasis : null,
      endOffsetMonths:
        form.forecastDriver === PRELIMS_DRIVERS.TIME ? coerceOffsetMonths(form.endOffsetMonths) : 0,
      endFixedDate:
        form.forecastDriver === PRELIMS_DRIVERS.TIME && form.endBasis === TIME_BASES.FIXED_DATE
          ? form.endFixedDate
          : null,
      lumpSumAmount:
        form.forecastDriver === PRELIMS_DRIVERS.LUMP_SUM ? Number(form.lumpSumAmount) : null,
    };
    try {
      if (saveIsEdit && editingId) {
        await updateDevelopmentPrelimsItem(developmentId, editingId, payload);
      } else {
        await createDevelopmentPrelimsItem(developmentId, payload);
      }
      enterAddMode();
      await load();
    } catch (err) {
      const message =
        err instanceof DevelopmentPrelimsApiError && err.status === 409
          ? 'This line was updated elsewhere. Reload and try again.'
          : err.message || 'Could not save Prelims line.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="dev-prelims" aria-label="Development Prelims">
      <div className="dev-prelims__banner" role="note">
        <strong>Prelims proposal only</strong>
        <p>
          These forecasts have not yet been adopted into the CVR. The CVR forecast remains
          unchanged.
        </p>
      </div>

      {collection ? (
        <dl className="dev-prelims__context">
          <div>
            <dt>Calculation as at</dt>
            <dd>
              {collection.reportingMonth
                ? `CVR reporting month ${collection.reportingMonth}`
                : 'No reporting month — TIME is unresolved'}
            </dd>
          </div>
          <div>
            <dt>Programme</dt>
            <dd>
              {collection.programme?.siteStart || '—'} → {collection.programme?.finalCompletion || '—'}
            </dd>
          </div>
          <div>
            <dt>Proposal summary</dt>
            <dd>
              {formatResolvedProposalText(
                summary?.development?.activeProposal,
                summary?.development?.unresolvedCount
              )}
            </dd>
          </div>
        </dl>
      ) : null}

      {error ? (
        <p className="dev-workspace__section-lead" role="alert">
          {error}
        </p>
      ) : null}

      {workspaceView === 'setup' ? (
        <DevelopmentPrelimsSetupWorksheet
          developmentId={developmentId}
          onCancel={() => setWorkspaceView('lines')}
          onApplied={async () => {
            setWorkspaceView('lines');
            await load();
          }}
        />
      ) : (
        <>
      <div className="dev-prelims__actions">
        <button
          className="btn"
          type="button"
          onClick={() => {
            setError('');
            setWorkspaceView('setup');
          }}
        >
          Set up site Prelims
        </button>
      </div>

      <form
        className={`dev-prelims__form${isEditMode ? ' dev-prelims__form--edit' : ''}`}
        onSubmit={handleSave}
        data-mode={isEditMode ? 'edit' : 'add'}
      >
        <h3>
          {isEditMode ? `Editing: ${form.name || 'Prelims line'}` : 'Add Prelims line'}
        </h3>
        <label>
          Cost code
          <input
            className="input"
            list="dev-prelims-cost-codes"
            value={form.costCodeKey}
            onChange={(event) => updateField('costCodeKey', event.target.value)}
            required
            aria-label="Prelims cost code"
          />
        </label>
        <datalist id="dev-prelims-cost-codes">
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
        {classificationHint ? <p className="dev-prelims__hint">{classificationHint}</p> : null}
        <label>
          Line name
          <input
            className="input"
            value={form.name}
            onChange={(event) => updateField('name', event.target.value)}
            required
            aria-label="Prelims line name"
          />
        </label>
        <label>
          Driver
          <select
            className="input"
            value={form.forecastDriver}
            onChange={(event) => updateField('forecastDriver', event.target.value)}
            aria-label="Prelims forecast driver"
          >
            <option value={PRELIMS_DRIVERS.TIME}>TIME</option>
            <option value={PRELIMS_DRIVERS.LUMP_SUM}>LUMP_SUM</option>
          </select>
        </label>
        <label>
          Status
          <select
            className="input"
            value={form.status}
            onChange={(event) => updateField('status', event.target.value)}
            aria-label="Prelims line status"
          >
            <option value={PRELIMS_STATUSES.ACTIVE}>Active</option>
            <option value={PRELIMS_STATUSES.COMPLETE}>Complete</option>
            <option value={PRELIMS_STATUSES.CANCELLED}>Cancelled</option>
          </select>
        </label>
        {form.forecastDriver === PRELIMS_DRIVERS.TIME ? (
          <>
            <label>
              Monthly rate
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={form.monthlyRate}
                onChange={(event) => updateField('monthlyRate', event.target.value)}
                required
                aria-label="Prelims monthly rate"
              />
            </label>
            <div className="dev-prelims__form-time">
              <PrelimsTimeSpanFields
                namePrefix="Prelims"
                startBasis={form.startBasis}
                startOffsetMonths={form.startOffsetMonths}
                startFixedDate={form.startFixedDate}
                endBasis={form.endBasis}
                endOffsetMonths={form.endOffsetMonths}
                endFixedDate={form.endFixedDate}
                resolvedStart={formTimeSpan.resolvedStart}
                resolvedEnd={formTimeSpan.resolvedEnd}
                totalMonths={formTimeSpan.totalMonths}
                outsideProgramme={formTimeSpan.outsideProgramme}
                onChange={updateField}
              />
            </div>
          </>
        ) : (
          <label>
            Lump-sum amount
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={form.lumpSumAmount}
              onChange={(event) => updateField('lumpSumAmount', event.target.value)}
              required
              aria-label="Prelims lump-sum amount"
            />
          </label>
        )}
        <div className="dev-prelims__actions">
          <button className="btn btn--primary" type="submit" disabled={saving}>
            {isEditMode ? 'Save line' : 'Create line'}
          </button>
          {isEditMode ? (
            <button className="btn" type="button" onClick={enterAddMode}>
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>

      {loading ? <p className="dev-workspace__section-lead">Loading Prelims lines…</p> : null}

      {!loading && !grouped.length ? (
        <p className="dev-workspace__section-support">
          No Prelims assumption lines yet. Multiple lines can share the same customer cost code.
        </p>
      ) : null}

      {grouped.map((group) => {
        const bucket = summary?.byCostCode?.find((row) => row.costCodeKey === group.costCodeKey);
        return (
          <article key={group.costCodeKey} className="dev-prelims__group">
            <header>
              <h3>Cost code {group.costCodeKey}</h3>
              <p>
                {formatResolvedProposalText(bucket?.activeProposal, bucket?.unresolvedCount)}
              </p>
            </header>
            {group.items.map((item) => (
              <div key={item.id} className="dev-prelims__line">
                <div className="dev-prelims__line-head">
                  <strong>{item.name}</strong>
                  <span>
                    {item.forecastDriver} · {item.status}
                  </span>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => startEdit(item)}
                    aria-label={`Edit ${item.name}`}
                  >
                    Edit
                  </button>
                </div>
                <LineCalc item={item} />
              </div>
            ))}
          </article>
        );
      })}
        </>
      )}
    </section>
  );
}
