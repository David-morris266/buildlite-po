/**
 * BL-032A — Revenue settings server mutation facade.
 * Live UI calls these only when VITE_REVENUE_SERVER_AUTHORITY is ON.
 */

import {
  RevenueSettingsApiError,
  putRevenueSettingsForDevelopment,
} from '../api/revenueSettings';
import { toServerRevenueSettingsPayload } from './revenueSettingsServerMapper';
import { replaceCachedRevenueSettings } from './revenueSettingsServerCache';

export const REVENUE_SETTINGS_VERSION_CONFLICT_MESSAGE =
  'Revenue settings were changed elsewhere. Refresh and retry.';

function mapApiError(error) {
  if (error instanceof RevenueSettingsApiError) {
    if (error.status === 409) {
      return {
        ok: false,
        errors: [error.body?.message || REVENUE_SETTINGS_VERSION_CONFLICT_MESSAGE],
        status: 409,
        settings: error.body?.settings || null,
      };
    }
    return {
      ok: false,
      errors: [error.body?.message || error.message || 'Revenue settings server request failed'],
      status: error.status,
      settings: error.body?.settings || null,
    };
  }
  return {
    ok: false,
    errors: [error?.message || 'Revenue settings server request failed'],
  };
}

export async function putServerRevenueSettings(developmentId, record = {}) {
  try {
    const document = await putRevenueSettingsForDevelopment(
      developmentId,
      toServerRevenueSettingsPayload(record)
    );
    const cached = replaceCachedRevenueSettings(developmentId, document);
    return { ok: true, record: cached, settings: cached };
  } catch (error) {
    return mapApiError(error);
  }
}
