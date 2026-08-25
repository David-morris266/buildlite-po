/**
 * BL-031C/D/E.4 — CVR period server mutation facade.
 *
 * Live UI calls these only when VITE_CVR_SERVER_AUTHORITY is ON.
 * Approve & Lock returns the immutable snapshot; cache the mapped period.
 */

import {
  CvrPeriodApiError,
  addCvrCostCodeMember,
  approveCvrPeriodForDevelopment,
  createCvrPeriodForDevelopment,
  createCvrPeriodInput,
  importCvrBudget,
  patchCvrPeriodForDevelopment,
  patchCvrPeriodInput,
  rejectCvrPeriodForDevelopment,
  submitCvrPeriodForDevelopment,
  upsertCvrPeriodInputs,
} from '../api/cvrPeriods';
import {
  replaceCachedCvrInputs,
  upsertCachedCvrInput,
  upsertCachedCvrPeriod,
} from './cvrPeriodServerCache';

export const CVR_PERIOD_VERSION_CONFLICT_MESSAGE =
  'This CVR period was changed elsewhere. Refresh and retry.';

function mapApiError(error) {
  const body = error instanceof CvrPeriodApiError ? error.body : null;
  const status = error instanceof CvrPeriodApiError ? error.status : 0;
  const message =
    body?.message ||
    (status === 409 ? CVR_PERIOD_VERSION_CONFLICT_MESSAGE : null) ||
    error.message ||
    'CVR period server request failed';
  return {
    ok: false,
    errors: [message],
    status,
    code: body?.code || null,
    period: body?.period || null,
    input: body?.input || null,
    unknownCodes: body?.unknownCodes || null,
    inactiveCodes: body?.inactiveCodes || null,
    duplicateCodes: body?.duplicateCodes || null,
  };
}

function cachePeriod(developmentId, period) {
  if (developmentId && period) {
    return upsertCachedCvrPeriod(developmentId, period) || period;
  }
  return period;
}

export async function createServerCvrPeriod(developmentId, payload = {}) {
  try {
    const period = await createCvrPeriodForDevelopment(developmentId, payload);
    return { ok: true, period: cachePeriod(developmentId, period) };
  } catch (error) {
    return mapApiError(error);
  }
}

export async function patchServerCvrPeriod(developmentId, periodId, payload = {}) {
  try {
    const period = await patchCvrPeriodForDevelopment(developmentId, periodId, payload);
    return { ok: true, period: cachePeriod(developmentId, period) };
  } catch (error) {
    return mapApiError(error);
  }
}

export async function submitServerCvrPeriod(developmentId, periodId, payload = {}) {
  try {
    const period = await submitCvrPeriodForDevelopment(developmentId, periodId, payload);
    return { ok: true, period: cachePeriod(developmentId, period) };
  } catch (error) {
    return mapApiError(error);
  }
}

export async function rejectServerCvrPeriod(developmentId, periodId, payload = {}) {
  try {
    const period = await rejectCvrPeriodForDevelopment(developmentId, periodId, payload);
    return { ok: true, period: cachePeriod(developmentId, period) };
  } catch (error) {
    return mapApiError(error);
  }
}

export async function approveServerCvrPeriod(developmentId, periodId, payload = {}) {
  try {
    const period = await approveCvrPeriodForDevelopment(developmentId, periodId, payload);
    const cached = cachePeriod(developmentId, period);
    return {
      ok: true,
      period: cached,
      snapshot: cached?.snapshot ?? null,
      snapshotDeferred: !cached?.snapshot,
    };
  } catch (error) {
    return mapApiError(error);
  }
}

export async function createServerCvrPeriodInput(developmentId, periodId, payload = {}) {
  try {
    const input = await createCvrPeriodInput(developmentId, periodId, payload);
    if (input) upsertCachedCvrInput(periodId, input);
    return { ok: true, input };
  } catch (error) {
    return mapApiError(error);
  }
}

export async function upsertServerCvrPeriodInputs(developmentId, periodId, payload = {}) {
  try {
    const result = await upsertCvrPeriodInputs(developmentId, periodId, payload);
    const inputs = Array.isArray(result) ? result : result?.inputs || [];
    replaceCachedCvrInputs(periodId, inputs);
    return { ok: true, inputs };
  } catch (error) {
    return mapApiError(error);
  }
}

export async function patchServerCvrPeriodInput(developmentId, periodId, inputId, payload = {}) {
  try {
    const input = await patchCvrPeriodInput(developmentId, periodId, inputId, payload);
    if (input) upsertCachedCvrInput(periodId, input);
    return { ok: true, input };
  } catch (error) {
    return mapApiError(error);
  }
}

export async function addServerCvrCostCodeMember(developmentId, periodId, payload = {}) {
  try {
    const input = await addCvrCostCodeMember(developmentId, periodId, payload);
    if (input) upsertCachedCvrInput(periodId, input);
    return { ok: true, input };
  } catch (error) {
    const mapped = mapApiError(error);
    if (mapped.code === 'COST_CODE_ALREADY_MEMBER' && mapped.input) {
      upsertCachedCvrInput(periodId, mapped.input);
    }
    return mapped;
  }
}

export async function importServerCvrBudget(developmentId, periodId, payload = {}) {
  try {
    const result = await importCvrBudget(developmentId, periodId, payload);
    const inputs = Array.isArray(result?.inputs) ? result.inputs : [];
    for (const input of inputs) {
      if (input) upsertCachedCvrInput(periodId, input);
    }
    return { ok: true, ...result };
  } catch (error) {
    return mapApiError(error);
  }
}
