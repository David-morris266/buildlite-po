/**
 * BL-031C/D — CVR period server mutation facade.
 *
 * Live UI calls these only when VITE_CVR_SERVER_AUTHORITY is ON.
 * Approve/lock is workflow-only; snapshots remain BL-031E.
 */

import {
  CvrPeriodApiError,
  approveCvrPeriodForDevelopment,
  createCvrPeriodForDevelopment,
  createCvrPeriodInput,
  patchCvrPeriodForDevelopment,
  patchCvrPeriodInput,
  rejectCvrPeriodForDevelopment,
  submitCvrPeriodForDevelopment,
  upsertCvrPeriodInputs,
} from '../api/cvrPeriods';
import {
  patchCachedCvrPeriod,
  replaceCachedCvrInputs,
  upsertCachedCvrInput,
  upsertCachedCvrPeriod,
} from './cvrPeriodServerCache';

export const CVR_PERIOD_VERSION_CONFLICT_MESSAGE =
  'This CVR period was changed elsewhere. Refresh and retry.';

function mapApiError(error) {
  if (error instanceof CvrPeriodApiError) {
    if (error.status === 409) {
      return {
        ok: false,
        errors: [error.body?.message || CVR_PERIOD_VERSION_CONFLICT_MESSAGE],
        status: 409,
        period: error.body?.period || null,
        input: error.body?.input || null,
      };
    }
    return {
      ok: false,
      errors: [error.body?.message || error.message || 'CVR period server request failed'],
      status: error.status,
      period: error.body?.period || null,
      input: error.body?.input || null,
    };
  }
  return {
    ok: false,
    errors: [error?.message || 'CVR period server request failed'],
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
    if (period) {
      patchCachedCvrPeriod(developmentId, periodId, period);
      cachePeriod(developmentId, period);
    }
    return { ok: true, period, snapshot: null, snapshotDeferred: true };
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
