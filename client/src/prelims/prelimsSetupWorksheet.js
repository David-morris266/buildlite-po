/**
 * BL-033D.x.3 — Commercial setup worksheet helpers.
 * Preview-only mapping and live TIME/LUMP_SUM forecasts. Does not write the company template.
 */

import { classifyTemplateMapping } from '../admin/prelimsTemplateMapping';
import {
  PRELIMS_DRIVERS,
  PRELIMS_UNRESOLVED_LABELS,
  TIME_BASES,
  TIME_BASIS_LABELS,
  TIME_OFFSET_MAX_MONTHS,
  TIME_OFFSET_MIN_MONTHS,
} from './prelimsConstants';
import { calculatePrelimsLine, resolveTimeSpan, roundMoney } from './prelimsForecastEngine';
import { coerceOffsetMonths } from '../programme/programmeCalendar';

export function parseAssumption(value) {
  if (value == null || String(value).trim() === '') return null;
  return roundMoney(value);
}

export function effectiveDriver(line, draft = {}) {
  const fromDraft = String(draft.forecastDriver || '').trim();
  if (fromDraft === PRELIMS_DRIVERS.TIME || fromDraft === PRELIMS_DRIVERS.LUMP_SUM) {
    return fromDraft;
  }
  return line?.forecastDriver || PRELIMS_DRIVERS.TIME;
}

export function draftsFromPreview(preview) {
  return (preview?.lines || []).map((line) => ({
    templateLineId: line.templateLineId,
    selected: Boolean(line.defaultSelected),
    costCodeKey: line.costCodeKey || '',
    forecastDriver: line.forecastDriver || PRELIMS_DRIVERS.TIME,
    monthlyRate: '',
    lumpSumAmount: '',
    startBasis: line.startBasis || TIME_BASES.SITE_START,
    startOffsetMonths: 0,
    startFixedDate: '',
    endBasis: line.endBasis || TIME_BASES.FINAL_COMPLETION,
    endOffsetMonths: 0,
    endFixedDate: '',
  }));
}

/** Apply a development-owned driver change; clears incompatible money/timing fields. */
export function draftAfterDriverChange(draft, nextDriver, line = {}) {
  const driver =
    nextDriver === PRELIMS_DRIVERS.LUMP_SUM ? PRELIMS_DRIVERS.LUMP_SUM : PRELIMS_DRIVERS.TIME;
  const next = { ...draft, forecastDriver: driver };
  if (driver === PRELIMS_DRIVERS.LUMP_SUM) {
    next.monthlyRate = '';
    return next;
  }
  next.lumpSumAmount = '';
  next.startBasis = draft.startBasis || line.startBasis || TIME_BASES.SITE_START;
  next.endBasis = draft.endBasis || line.endBasis || TIME_BASES.FINAL_COMPLETION;
  next.startOffsetMonths = coerceOffsetMonths(draft.startOffsetMonths);
  next.endOffsetMonths = coerceOffsetMonths(draft.endOffsetMonths);
  if (next.startBasis === TIME_BASES.FIXED_DATE) next.startOffsetMonths = 0;
  if (next.endBasis === TIME_BASES.FIXED_DATE) next.endOffsetMonths = 0;
  return next;
}

export function timeLineFromDraft(line, draft = {}) {
  const forecastDriver = effectiveDriver(line, draft);
  return {
    forecastDriver,
    status: 'active',
    startBasis: draft.startBasis || line.startBasis,
    startOffsetMonths: coerceOffsetMonths(draft.startOffsetMonths),
    startFixedDate: draft.startFixedDate || null,
    endBasis: draft.endBasis || line.endBasis,
    endOffsetMonths: coerceOffsetMonths(draft.endOffsetMonths),
    endFixedDate: draft.endFixedDate || null,
    monthlyRate: parseAssumption(draft.monthlyRate),
    lumpSumAmount: parseAssumption(draft.lumpSumAmount),
  };
}

function offsetInRange(value) {
  const n = coerceOffsetMonths(value);
  return n >= TIME_OFFSET_MIN_MONTHS && n <= TIME_OFFSET_MAX_MONTHS;
}

export function hasValidAssumption(line, draft) {
  if (effectiveDriver(line, draft) === PRELIMS_DRIVERS.TIME) {
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

export function isLineReady(line, draft, programme = null) {
  if (!line?.enabled || line.alreadyApplied || !draft?.selected) return false;
  if (!String(draft.costCodeKey || '').trim()) return false;
  if (!hasValidAssumption(line, draft)) return false;
  if (effectiveDriver(line, draft) === PRELIMS_DRIVERS.TIME) {
    const startBasis = draft.startBasis || line.startBasis;
    const endBasis = draft.endBasis || line.endBasis;
    if (startBasis === TIME_BASES.FIXED_DATE && !String(draft.startFixedDate || '').trim()) {
      return false;
    }
    if (endBasis === TIME_BASES.FIXED_DATE && !String(draft.endFixedDate || '').trim()) {
      return false;
    }
    if (!offsetInRange(draft.startOffsetMonths) || !offsetInRange(draft.endOffsetMonths)) {
      return false;
    }
    const span = resolveTimeSpan(timeLineFromDraft(line, draft), programme);
    if (span.state === 'invalid') return false;
  }
  return true;
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
    return effectiveDriver(line, draft) === PRELIMS_DRIVERS.TIME ? 'Enter £/month' : 'Enter amount';
  }
  if (!draft.selected) return 'Not selected';
  return 'Not ready';
}

export function livePreviewCalculation(line, draft, programme, reportingMonth) {
  const shaped = timeLineFromDraft(line, draft);
  const span = resolveTimeSpan(shaped, programme);
  const calc = calculatePrelimsLine(shaped, { programme, reportingMonth });
  return { span, calc };
}

export function durationLabel(line, span, draft = {}) {
  if (effectiveDriver(line, draft) !== PRELIMS_DRIVERS.TIME) return '—';
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

/** Compact State-column chips. Classification/overlap semantics unchanged. */
export function setupStateChips({
  classification,
  overlapInfo,
  outsideProgramme = false,
  timeUnresolvedLabel = null,
} = {}) {
  const chips = [];
  if (classification?.tone === 'unmapped') {
    chips.push({ tone: 'muted', text: 'Unmapped' });
  } else if (classification?.tone === 'normal') {
    chips.push({ tone: 'quiet', text: 'PRELIMS' });
  } else if (classification?.tone === 'warning') {
    const groupMatch = String(classification.message || '').match(/classified\s+(\S+)\s+rather/i);
    const group = groupMatch?.[1] || 'UNCLASSIFIED';
    chips.push({ tone: 'warn', text: group });
    chips.push({ tone: 'warn', text: 'Expected PRELIMS' });
  }
  if (overlapInfo?.overlap) {
    const existing = overlapInfo.existingNames?.length || 0;
    const siblings = overlapInfo.siblingNames?.length || 0;
    const n = existing + siblings;
    const noun = n === 1 ? 'line' : 'lines';
    chips.push({
      tone: 'info',
      text: existing
        ? `Overlap · ${existing} existing ${existing === 1 ? 'line' : 'lines'}`
        : `Overlap · ${n} ${noun}`,
    });
  }
  if (outsideProgramme) {
    chips.push({ tone: 'warn', text: 'Outside programme' });
  }
  if (timeUnresolvedLabel) {
    chips.push({ tone: 'warn', text: timeUnresolvedLabel });
  }
  return chips;
}

export function applyPayloadFromDrafts(preview, drafts) {
  const byId = new Map((preview?.lines || []).map((line) => [line.templateLineId, line]));
  return {
    templateId: preview.template.id,
    templateVersion: preview.template.version,
    lines: drafts
      .filter((draft) => isLineReady(byId.get(draft.templateLineId), draft, preview.programme))
      .map((draft) => {
        const line = byId.get(draft.templateLineId);
        const forecastDriver = effectiveDriver(line, draft);
        const isTime = forecastDriver === PRELIMS_DRIVERS.TIME;
        return {
          templateLineId: draft.templateLineId,
          selected: true,
          costCodeKey: String(draft.costCodeKey || '').trim(),
          forecastDriver,
          monthlyRate: isTime ? parseAssumption(draft.monthlyRate) : null,
          lumpSumAmount: isTime ? null : parseAssumption(draft.lumpSumAmount),
          startBasis: isTime ? draft.startBasis || line.startBasis : null,
          startOffsetMonths: isTime ? coerceOffsetMonths(draft.startOffsetMonths) : 0,
          startFixedDate:
            isTime && (draft.startBasis || line.startBasis) === TIME_BASES.FIXED_DATE
              ? draft.startFixedDate || null
              : null,
          endBasis: isTime ? draft.endBasis || line.endBasis : null,
          endOffsetMonths: isTime ? coerceOffsetMonths(draft.endOffsetMonths) : 0,
          endFixedDate:
            isTime && (draft.endBasis || line.endBasis) === TIME_BASES.FIXED_DATE
              ? draft.endFixedDate || null
              : null,
        };
      }),
  };
}
