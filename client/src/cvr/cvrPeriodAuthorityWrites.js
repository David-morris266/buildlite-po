/**
 * BL-031D — CVR server-authority write adapter.
 *
 * Called only when VITE_CVR_SERVER_AUTHORITY is ON. Never writes localStorage.
 */

import { mapLocalCommentary, mapLocalCostCodeInput } from './cvrLocalServerMapper';
import {
  getCachedCvrInputs,
  getCachedCvrPeriodByKey,
} from './cvrPeriodServerCache';
import {
  approveServerCvrPeriod,
  createServerCvrPeriod,
  createServerCvrPeriodInput,
  patchServerCvrPeriod,
  patchServerCvrPeriodInput,
  rejectServerCvrPeriod,
  submitServerCvrPeriod,
  upsertServerCvrPeriodInputs,
} from './cvrPeriodServerMutations';
import { formatNextPeriodKey } from './cvrPeriodStatus';

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

export async function createDraftPeriodOnServer(developmentId, {
  periodKeys,
  sourcePeriod,
} = {}) {
  const nextKey = formatNextPeriodKey(periodKeys || []);
  const commentary = mapLocalCommentary(sourcePeriod?.commercialCommentary);
  const created = await createServerCvrPeriod(developmentId, {
    periodKey: nextKey,
    periodLabel: nextKey,
    commentary,
  });
  if (!created.ok) return created;

  const sourceInputs = (sourcePeriod?.costCentres || getCachedCvrInputs(sourcePeriod?.id) || [])
    .filter((item) => item.active !== false);
  if (sourceInputs.length && created.period?.id) {
    const inputs = [];
    for (const centre of sourceInputs) {
      const mapped = mapLocalCostCodeInput({
        ...centre,
        adjustmentHistory: [],
      });
      if (!mapped.ok) return { ok: false, errors: mapped.errors };
      inputs.push(mapped.value);
    }
    const upserted = await upsertServerCvrPeriodInputs(developmentId, created.period.id, {
      inputs,
    });
    if (!upserted.ok) return upserted;
  }

  return {
    ok: true,
    periodKey: created.period.periodKey,
    period: created.period,
    opened: false,
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
