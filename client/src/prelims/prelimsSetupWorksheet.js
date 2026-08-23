/**
 * BL-033D.x.3 — Commercial setup worksheet helpers.
 * Preview-only mapping and live TIME/LUMP_SUM forecasts. Does not write the company template.
 */

import { classifyTemplateMapping } from '../admin/prelimsTemplateMapping';
import {
  PRELIMS_DRIVERS,
  PRELIMS_UNRESOLVED_LABELS,
  TIME_BASIS_LABELS,
} from './prelimsConstants';
import { calculatePrelimsLine, resolveTimeSpan, roundMoney } from './prelimsForecastEngine';

export function parseAssumption(value) {
  if (value == null || String(value).trim() === '') return null;
  return roundMoney(value);
}

export function draftsFromPreview(preview) {
  return (preview?.lines || []).map((line) => ({
    templateLineId: line.templateLineId,
    selected: Boolean(line.defaultSelected),
    costCodeKey: line.costCodeKey || '',
    monthlyRate: '',
    lumpSumAmount: '',
  }));
}

export function hasValidAssumption(line, draft) {
  if (line.forecastDriver === PRELIMS_DRIVERS.TIME) {
    const rate = parseAssumption(draft.monthlyRate);
    return rate != null && rate >= 0;
  }
  const amount = parseAssumption(draft.lumpSumAmount);
  return amount != null && amount >= 0;
}

export function computeOverlap(line, draft, preview, drafts = []) {
  const key = String(draft.costCodeKey || '').trim().toLowerCase();
  if (!key) {
    return { overlap: false, existingNames: [], siblingNames: [] };
  }
  const existingNames = (preview?.existingItems || [])
    .filter((item) => String(item.costCodeKey || '').trim().toLowerCase() === key)
    .map((item) => item.name);
  const siblingNames = (drafts || [])
    .filter((other) => {
      if (other.templateLineId === line.templateLineId) return false;
      return String(other.costCodeKey || '').trim().toLowerCase() === key;
    })
    .map((other) => {
      const match = (preview?.lines || []).find((row) => row.templateLineId === other.templateLineId);
      return match?.name || other.templateLineId;
    });
  return {
    overlap: existingNames.length > 0 || siblingNames.length > 0,
    existingNames,
    siblingNames,
  };
}

export function isLineReady(line, draft) {
  if (!line?.enabled || line.alreadyApplied || !draft?.selected) return false;
  if (!String(draft.costCodeKey || '').trim()) return false;
  return hasValidAssumption(line, draft);
}

export function readyStateLabel(line, draft, overlap) {
  if (!line.enabled) return 'Disabled — not instantiated';
  if (line.alreadyApplied) return 'Already on this development';
  const mapped = Boolean(String(draft.costCodeKey || '').trim());
  const money = hasValidAssumption(line, draft);
  if (draft.selected && mapped && money) {
    return overlap ? 'Ready · overlap' : 'Ready';
  }
  if (!mapped) return 'Unmapped';
  if (!money) {
    return line.forecastDriver === PRELIMS_DRIVERS.TIME ? 'Enter £/month' : 'Enter amount';
  }
  if (!draft.selected) return 'Not selected';
  return 'Not ready';
}

export function livePreviewCalculation(line, draft, programme, reportingMonth) {
  const span = resolveTimeSpan(line, programme);
  const calc = calculatePrelimsLine(
    {
      forecastDriver: line.forecastDriver,
      status: 'active',
      startBasis: line.startBasis,
      endBasis: line.endBasis,
      monthlyRate: parseAssumption(draft.monthlyRate),
      lumpSumAmount: parseAssumption(draft.lumpSumAmount),
    },
    { programme, reportingMonth }
  );
  return { span, calc };
}

export function durationLabel(line, span) {
  if (line.forecastDriver !== PRELIMS_DRIVERS.TIME) return '—';
  if (span?.state === 'resolved' && span.totalMonths != null) {
    return `${span.totalMonths} months`;
  }
  return span?.reasonLabel || PRELIMS_UNRESOLVED_LABELS[span?.reason] || 'Unresolved';
}

export function basisLabel(line) {
  if (line.forecastDriver !== PRELIMS_DRIVERS.TIME) return '—';
  const start = TIME_BASIS_LABELS[line.startBasis] || line.startBasis || '—';
  const end = TIME_BASIS_LABELS[line.endBasis] || line.endBasis || '—';
  return `${start} → ${end}`;
}

export function classificationForDraft(draft, semanticGroup) {
  return classifyTemplateMapping(draft.costCodeKey, semanticGroup);
}

export function applyPayloadFromDrafts(preview, drafts) {
  const byId = new Map((preview?.lines || []).map((line) => [line.templateLineId, line]));
  return {
    templateId: preview.template.id,
    templateVersion: preview.template.version,
    lines: drafts
      .filter((draft) => isLineReady(byId.get(draft.templateLineId), draft))
      .map((draft) => {
        const line = byId.get(draft.templateLineId);
        return {
          templateLineId: draft.templateLineId,
          selected: true,
          costCodeKey: String(draft.costCodeKey || '').trim(),
          monthlyRate:
            line.forecastDriver === PRELIMS_DRIVERS.TIME ? parseAssumption(draft.monthlyRate) : null,
          lumpSumAmount:
            line.forecastDriver === PRELIMS_DRIVERS.LUMP_SUM
              ? parseAssumption(draft.lumpSumAmount)
              : null,
        };
      }),
  };
}
