/**
 * BL-033C.1 — Create Next Period reporting-month prompt.
 * Always show the selected month. Prefill previous+1 when that is safe.
 * Never invent today or infer from the period key.
 */

import {
  canCreateNextCvrPeriod,
} from './cvrPeriodStatus';
import {
  getLatestLockedCvrPeriod,
  listCvrPeriods,
} from './cvrPeriodStore';
import { buildCreateNextReportingMonthPrompt } from './cvrReportingMonth';

export function resolveCreateNextReportingMonthAction(developmentId) {
  const periods = listCvrPeriods(developmentId);
  const gate = canCreateNextCvrPeriod(periods);
  if (gate.draftPeriodKey) {
    return {
      kind: 'recover',
      draftPeriodKey: gate.draftPeriodKey,
    };
  }
  if (!gate.ok) {
    return {
      kind: 'blocked',
      reason: gate.reason || 'Cannot create the next CVR period.',
    };
  }

  const sourcePeriod =
    getLatestLockedCvrPeriod(developmentId) || periods[periods.length - 1] || null;
  const prompt = buildCreateNextReportingMonthPrompt({
    periods,
    sourcePeriod,
  });

  return {
    kind: 'prompt',
    suggestedMonth: prompt.suggestedMonth,
    nextPeriodKey: prompt.nextPeriodKey,
    requiresExplicitSelection: prompt.requiresExplicitSelection,
    sourcePeriodKey: sourcePeriod?.periodKey || null,
  };
}
