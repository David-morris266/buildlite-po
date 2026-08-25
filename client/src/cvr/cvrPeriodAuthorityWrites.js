/**
 * BL-031D / BL-031F — CVR server-authority write adapter.
 *
 * Called only when VITE_CVR_SERVER_AUTHORITY is ON. Never writes localStorage.
 * Create Next Period copies persisted QS inputs, not historic snapshot money
 * or empty list-mapper costCentres.
 */

import { normaliseCostCodeKey } from './cvrCalculations';
import { mapLocalCommentary, mapLocalCostCodeInput } from './cvrLocalServerMapper';
import {
  ensureCvrInputsReadyForPeriod,
  getCachedCvrInputs,
  getCachedCvrPeriodByKey,
} from './cvrPeriodServerCache';
import {
  addServerCvrCostCodeMember,
  approveServerCvrPeriod,
  createServerCvrPeriod,
  createServerCvrPeriodInput,
  importServerCvrBudget,
  patchServerCvrPeriod,
  patchServerCvrPeriodInput,
  rejectServerCvrPeriod,
  submitServerCvrPeriod,
  upsertServerCvrPeriodInputs,
} from './cvrPeriodServerMutations';
import { formatNextPeriodKey } from './cvrPeriodStatus';
import { reportingMonthForNextCvrPeriod } from './cvrReportingMonth';
import { toYearMonth } from '../programme/programmeCalendar';

function periodNotFound() {
  return { ok: false, errors: ['CVR period not found.'] };
}

function requireCachedPeriod(developmentId, periodKey) {
  const period = getCachedCvrPeriodByKey(developmentId, periodKey);
  if (!period?.id) return { ok: false, ...periodNotFound(), period: null };
  return { ok: true, period };
}

function toServerInputPayload(centre) {
  const mapped = mapLocalCostCodeInput(centre);
  if (!mapped.ok) return mapped;
  return {
    ok: true,
    value: {
      ...mapped.value,
      version: centre.version,
    },
  };
}

function inputKeyOf(item) {
  return normaliseCostCodeKey(item?.costCodeKey || item?.costCode);
}

function activeInputs(inputs) {
  return (Array.isArray(inputs) ? inputs : []).filter((item) => item?.active !== false);
}

function keySetOf(inputs) {
  return new Set(activeInputs(inputs).map(inputKeyOf).filter(Boolean));
}

function sameKeySet(left, right) {
  if (left.size !== right.size) return false;
  for (const key of left) {
    if (!right.has(key)) return false;
  }
  return true;
}

function mapOpeningQsInputs(sourceInputs) {
  const inputs = [];
  for (const centre of activeInputs(sourceInputs)) {
    const mapped = mapLocalCostCodeInput({
      ...centre,
      adjustmentHistory: [],
    });
    if (!mapped.ok) return mapped;
    inputs.push({
      costCodeKey: mapped.value.costCodeKey,
      costCodeLabel: mapped.value.costCodeLabel,
      description: mapped.value.description,
      commercialHead: mapped.value.commercialHead,
      commercialFamily: mapped.value.commercialFamily,
      trade: mapped.value.trade,
      originalBudget: mapped.value.originalBudget,
      currentBudget: mapped.value.currentBudget,
      commercialAdjustment: mapped.value.commercialAdjustment,
      adjustmentReason: mapped.value.adjustmentReason,
      commercialReason: mapped.value.commercialReason,
      manualAccrual: mapped.value.manualAccrual,
      notes: mapped.value.notes,
      active: mapped.value.active,
      displayMetadata: {
        ...(mapped.value.displayMetadata && typeof mapped.value.displayMetadata === 'object'
          ? mapped.value.displayMetadata
          : {}),
        adjustmentHistory: [],
      },
      adjustmentHistory: [],
    });
  }
  return { ok: true, inputs };
}

async function loadPersistedQsInputs(developmentId, period) {
  if (!period?.id) {
    return { ok: true, inputs: [] };
  }
  try {
    const loaded = await ensureCvrInputsReadyForPeriod(developmentId, period.id);
    const inputs = activeInputs(
      Array.isArray(loaded) && loaded.length ? loaded : getCachedCvrInputs(period.id)
    );
    return { ok: true, inputs };
  } catch (error) {
    return {
      ok: false,
      errors: [
        error?.message ||
          'Unable to load the previous period QS inputs to copy into the next CVR.',
      ],
    };
  }
}

export async function copyOpeningInputsOntoDraft(developmentId, {
  sourcePeriod,
  targetPeriod,
} = {}) {
  if (!targetPeriod?.id) {
    return { ok: false, errors: ['Draft CVR period has no identity.'] };
  }

  const source = await loadPersistedQsInputs(developmentId, sourcePeriod);
  if (!source.ok) return source;

  let targetInputs = [];
  try {
    targetInputs = await ensureCvrInputsReadyForPeriod(developmentId, targetPeriod.id);
  } catch (error) {
    return {
      ok: false,
      errors: [
        error?.message || 'Unable to load the new CVR period QS inputs.',
      ],
      period: targetPeriod,
      periodKey: targetPeriod.periodKey,
    };
  }

  const expectedKeys = keySetOf(source.inputs);
  const existingKeys = keySetOf(targetInputs);

  if (expectedKeys.size === 0) {
    return { ok: true, copied: false, period: targetPeriod };
  }

  if (existingKeys.size === 0) {
    const mapped = mapOpeningQsInputs(source.inputs);
    if (!mapped.ok) return mapped;
    const upserted = await upsertServerCvrPeriodInputs(developmentId, targetPeriod.id, {
      inputs: mapped.inputs,
    });
    if (!upserted.ok) {
      return {
        ok: false,
        errors: [
          upserted.errors?.[0] ||
            `${targetPeriod.periodKey} was created but its QS opening inputs could not be copied. Open the draft and retry Create Next Period.`,
        ],
        status: upserted.status,
        period: targetPeriod,
        periodKey: targetPeriod.periodKey,
        copyFailed: true,
      };
    }
    return {
      ok: true,
      copied: true,
      period: targetPeriod,
      inputs: upserted.inputs,
    };
  }

  if (sameKeySet(expectedKeys, existingKeys)) {
    return {
      ok: true,
      copied: false,
      alreadyComplete: true,
      period: targetPeriod,
    };
  }

  return {
    ok: false,
    errors: [
      `${targetPeriod.periodKey} already has QS inputs that do not match the previous locked period. Opening values were not overwritten.`,
    ],
    period: targetPeriod,
    periodKey: targetPeriod.periodKey,
    conflict: true,
  };
}

export async function recoverOrOpenDraftPeriodOnServer(developmentId, {
  draftPeriod,
  sourcePeriod,
} = {}) {
  if (!draftPeriod?.id) return periodNotFound();
  const copied = await copyOpeningInputsOntoDraft(developmentId, {
    sourcePeriod,
    targetPeriod: draftPeriod,
  });
  if (!copied.ok) return copied;
  return {
    ok: true,
    periodKey: draftPeriod.periodKey,
    period: draftPeriod,
    opened: true,
    recovered: Boolean(copied.copied),
    alreadyComplete: Boolean(copied.alreadyComplete),
  };
}

export async function createDraftPeriodOnServer(developmentId, {
  periodKeys,
  sourcePeriod,
  reportingMonth,
} = {}) {
  if (sourcePeriod?.id) {
    const source = await loadPersistedQsInputs(developmentId, sourcePeriod);
    if (!source.ok) return source;
  }

  const nextKey = formatNextPeriodKey(periodKeys || []);
  const commentary = mapLocalCommentary(sourcePeriod?.commercialCommentary);
  let nextReportingMonth = null;
  if (reportingMonth != null && String(reportingMonth).trim() !== '') {
    nextReportingMonth = toYearMonth(reportingMonth);
    if (!nextReportingMonth) {
      return { ok: false, errors: ['Reporting month must be YYYY-MM.'] };
    }
  } else {
    nextReportingMonth = reportingMonthForNextCvrPeriod(sourcePeriod);
  }
  const created = await createServerCvrPeriod(developmentId, {
    periodKey: nextKey,
    periodLabel: nextKey,
    commentary,
    ...(nextReportingMonth ? { reportingMonth: nextReportingMonth } : {}),
  });
  if (!created.ok) return created;

  const copied = await copyOpeningInputsOntoDraft(developmentId, {
    sourcePeriod,
    targetPeriod: created.period,
  });
  if (!copied.ok) {
    return {
      ...copied,
      periodKey: created.period.periodKey,
      period: created.period,
      opened: false,
    };
  }

  return {
    ok: true,
    periodKey: created.period.periodKey,
    period: created.period,
    opened: false,
    copied: Boolean(copied.copied),
  };
}

export async function submitPeriodOnServer(developmentId, periodKey) {
  const resolved = requireCachedPeriod(developmentId, periodKey);
  if (!resolved.ok) return resolved;
  const result = await submitServerCvrPeriod(developmentId, resolved.period.id, {
    version: resolved.period.version,
  });
  if (!result.ok) return result;
  return { ok: true, period: result.period, periodKey };
}

export async function approvePeriodOnServer(developmentId, periodKey) {
  const resolved = requireCachedPeriod(developmentId, periodKey);
  if (!resolved.ok) return resolved;
  const result = await approveServerCvrPeriod(developmentId, resolved.period.id, {
    version: resolved.period.version,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    period: result.period,
    periodKey,
    snapshot: result.snapshot ?? result.period?.snapshot ?? null,
    snapshotDeferred: Boolean(result.snapshotDeferred),
  };
}

export async function rejectPeriodOnServer(developmentId, periodKey, comment) {
  const resolved = requireCachedPeriod(developmentId, periodKey);
  if (!resolved.ok) return resolved;
  const result = await rejectServerCvrPeriod(developmentId, resolved.period.id, {
    version: resolved.period.version,
    comment,
  });
  if (!result.ok) return result;
  return { ok: true, period: result.period, periodKey };
}

export async function savePeriodCommentaryOnServer(developmentId, periodKey, commentary) {
  const resolved = requireCachedPeriod(developmentId, periodKey);
  if (!resolved.ok) return resolved;
    const result = await patchServerCvrPeriod(developmentId, resolved.period.id, {
    version: resolved.period.version,
    commentary: mapLocalCommentary(commentary),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    commercialCommentary: result.period.commercialCommentary || mapLocalCommentary(result.period.commentary),
    period: result.period,
    periodKey,
  };
}

export async function createCostCentreOnServer(developmentId, periodKey, centre) {
  const resolved = requireCachedPeriod(developmentId, periodKey);
  if (!resolved.ok) return resolved;
  const mapped = toServerInputPayload(centre);
  if (!mapped.ok) return mapped;
  const result = await createServerCvrPeriodInput(developmentId, resolved.period.id, mapped.value);
  if (!result.ok) return result;
  return { ok: true, costCentre: result.input };
}

export async function patchCostCentreOnServer(developmentId, periodKey, centre) {
  const resolved = requireCachedPeriod(developmentId, periodKey);
  if (!resolved.ok) return resolved;
  if (!centre?.id) return { ok: false, errors: ['Cost code not found.'] };
  const mapped = toServerInputPayload(centre);
  if (!mapped.ok) return mapped;
  const result = await patchServerCvrPeriodInput(
    developmentId,
    resolved.period.id,
    centre.id,
    mapped.value
  );
  if (!result.ok) return result;
  return { ok: true, costCentre: result.input };
}

export async function addCostCodeMemberOnServer(developmentId, periodKey, costCodeKey, actor) {
  const resolved = requireCachedPeriod(developmentId, periodKey);
  if (!resolved.ok) return resolved;
  const key = String(costCodeKey || '').trim();
  if (!key) return { ok: false, errors: ['Cost code is required.'] };
  const result = await addServerCvrCostCodeMember(developmentId, resolved.period.id, {
    costCodeKey: key,
    actor,
  });
  if (!result.ok) return result;
  return { ok: true, input: result.input, costCentre: result.input };
}

export async function importBudgetOnServer(developmentId, periodKey, rows, actor) {
  const resolved = requireCachedPeriod(developmentId, periodKey);
  if (!resolved.ok) return resolved;
  return importServerCvrBudget(developmentId, resolved.period.id, { rows, actor });
}
