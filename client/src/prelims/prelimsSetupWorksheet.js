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
    // Preview metadata must never opt a Development into a Prelims line. This is
    // deliberately browser-local until the user selects and adds the line.
    selected: false,
    costCodeKey: line.costCodeKey || '',
    forecastDriver: line.forecastDriver || PRELIMS_DRIVERS.TIME,
    monthlyRate: line.monthlyRate == null ? '' : String(line.monthlyRate),
    lumpSumAmount: line.lumpSumAmount == null ? '' : String(line.lumpSumAmount),
    startBasis: line.startBasis || TIME_BASES.SITE_START,
    startOffsetMonths: 0,
    startFixedDate: '',
    endBasis: line.endBasis || TIME_BASES.FINAL_COMPLETION,
    endOffsetMonths: 0,
    endFixedDate: '',
  }));
}

export function normalizeSetupDraft(draft = {}) {
  const driver =
    draft.forecastDriver === PRELIMS_DRIVERS.LUMP_SUM
      ? PRELIMS_DRIVERS.LUMP_SUM
      : PRELIMS_DRIVERS.TIME;
  return {
    templateLineId: String(draft.templateLineId || ''),
    selected: Boolean(draft.selected),
    costCodeKey: String(draft.costCodeKey || '').trim(),
    forecastDriver: driver,
    monthlyRate: driver === PRELIMS_DRIVERS.TIME ? parseAssumption(draft.monthlyRate) : null,
    lumpSumAmount:
      driver === PRELIMS_DRIVERS.LUMP_SUM ? parseAssumption(draft.lumpSumAmount) : null,
    startBasis:
      driver === PRELIMS_DRIVERS.TIME
        ? draft.startBasis || TIME_BASES.SITE_START
        : null,
    startOffsetMonths:
      driver === PRELIMS_DRIVERS.TIME ? coerceOffsetMonths(draft.startOffsetMonths) : 0,
    startFixedDate:
      driver === PRELIMS_DRIVERS.TIME && draft.startBasis === TIME_BASES.FIXED_DATE
        ? String(draft.startFixedDate || '').trim()
        : '',
    endBasis:
      driver === PRELIMS_DRIVERS.TIME
        ? draft.endBasis || TIME_BASES.FINAL_COMPLETION
        : null,
    endOffsetMonths:
      driver === PRELIMS_DRIVERS.TIME ? coerceOffsetMonths(draft.endOffsetMonths) : 0,
    endFixedDate:
      driver === PRELIMS_DRIVERS.TIME && draft.endBasis === TIME_BASES.FIXED_DATE
        ? String(draft.endFixedDate || '').trim()
        : '',
  };
}

export function setupDraftsAreDirty(drafts = [], baselineDrafts = []) {
  const baseline = new Map(
    baselineDrafts.map((draft) => [draft.templateLineId, normalizeSetupDraft(draft)])
  );
  return drafts.some((draft) => {
    const normalized = normalizeSetupDraft(draft);
    return JSON.stringify(normalized) !== JSON.stringify(baseline.get(draft.templateLineId) || null);
  });
}

export function mergeDraftsAfterIncrementalAdd(preview, currentDrafts = []) {
  const currentById = new Map(currentDrafts.map((draft) => [draft.templateLineId, draft]));
  return draftsFromPreview(preview).map((fresh) => {
    const line = (preview?.lines || []).find(
      (candidate) => candidate.templateLineId === fresh.templateLineId
    );
    if (line?.alreadyApplied) return fresh;
    return currentById.get(fresh.templateLineId) || fresh;
  });
}

export function setupProgress(preview, drafts = []) {
  const byId = new Map((preview?.lines || []).map((line) => [line.templateLineId, line]));
  return drafts.reduce(
    (summary, draft) => {
      if (!draft.selected || byId.get(draft.templateLineId)?.alreadyApplied) return summary;
      summary.selected += 1;
      const line = byId.get(draft.templateLineId);
      const configured = isLineSaveable(line, draft);
      if (configured) {
        summary.configured += 1;
        const live = livePreviewCalculation(
          line,
          draft,
          preview?.programme,
          preview?.reportingMonth
        );
        if (live.calc.state === 'resolved' && live.calc.totalForecast != null) {
          summary.resolved += 1;
          summary.resolvedForecast = roundMoney(summary.resolvedForecast + live.calc.totalForecast);
        } else {
          summary.unresolved += 1;
        }
      } else {
        summary.needsAttention += 1;
        const live = line
          ? livePreviewCalculation(line, draft, preview?.programme, preview?.reportingMonth)
          : null;
        if (live?.calc?.state !== 'resolved') summary.unresolved += 1;
      }
      return summary;
    },
    { selected: 0, configured: 0, resolved: 0, needsAttention: 0, resolvedForecast: 0, unresolved: 0 }
  );
}

export function mappingProvenance(line, draft = {}) {
  const companyCode = String(line?.costCodeKey || '').trim();
  const developmentCode = String(draft?.costCodeKey || '').trim();
  if (!companyCode) {
    return {
      state: 'company_unmapped',
      label: 'Company template unmapped',
      detail:
        'Choose a site-specific exception here, or complete the reusable company mapping in Administration.',
    };
  }
  if (developmentCode !== companyCode) {
    return {
      state: 'development_override',
      label: 'Development override',
      detail: 'This site has selected a different Cost Code from the company template.',
    };
  }
  return {
    state: 'company_mapping',
    label: 'Company mapping',
    detail: 'Inherited from the selected company template.',
  };
}

export function displayPrelimIdentity(line = {}) {
  if (line.templateKey === 'bl.prelims.v1.site_admin') {
    return {
      name: 'Site Administrator / Site Office Support',
      guidance:
        'Site-based administrator, document controller or coordinator supporting the development. Excludes head-office/corporate administration.',
    };
  }
  return {
    name: line.name || '',
    guidance: line.guidance || '',
  };
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

/** Valid Development configuration, independent of programme forecast resolution. */
export function isLineConfigured(line, draft) {
  if (!line?.enabled || line.alreadyApplied || !String(draft?.costCodeKey || '').trim()) return false;
  if (!hasValidAssumption(line, draft)) return false;
  if (effectiveDriver(line, draft) !== PRELIMS_DRIVERS.TIME) return true;
  const startBasis = draft.startBasis || line.startBasis;
  const endBasis = draft.endBasis || line.endBasis;
  if (startBasis === TIME_BASES.FIXED_DATE && !String(draft.startFixedDate || '').trim()) return false;
  if (endBasis === TIME_BASES.FIXED_DATE && !String(draft.endFixedDate || '').trim()) return false;
  return offsetInRange(draft.startOffsetMonths) && offsetInRange(draft.endOffsetMonths);
}

export function isLineSaveable(line, draft) {
  return Boolean(draft?.selected) && isLineConfigured(line, draft);
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
  if (!isLineSaveable(line, draft)) return false;
  if (effectiveDriver(line, draft) === PRELIMS_DRIVERS.TIME) {
    const span = resolveTimeSpan(timeLineFromDraft(line, draft), programme);
    if (span.state !== 'resolved') return false;
  }
  return true;
}

export function groupSetupLines(lines = [], drafts = []) {
  const draftById = new Map(drafts.map((draft) => [draft.templateLineId, draft]));
  const groups = new Map();
  for (const line of lines.filter((candidate) => candidate.enabled)) {
    const draft = draftById.get(line.templateLineId) || {};
    const costCodeKey = String(draft.costCodeKey || '').trim();
    const key = costCodeKey ? costCodeKey.toLowerCase() : `unmapped:${line.templateLineId}`;
    if (!groups.has(key)) groups.set(key, { key, costCodeKey, lines: [] });
    groups.get(key).lines.push(line);
  }
  return [...groups.values()];
}

export function summarizeSetupGroup(group, drafts, programme, reportingMonth) {
  const draftById = new Map(drafts.map((draft) => [draft.templateLineId, draft]));
  const configured = group.lines.filter((line) =>
    isLineSaveable(line, draftById.get(line.templateLineId))
  );
  if (!configured.length) return { configuredCount: 0, resolvedCount: 0, forecast: null };
  const calculations = configured.map((line) =>
    livePreviewCalculation(line, draftById.get(line.templateLineId), programme, reportingMonth)
  );
  const resolved = calculations.filter(
    ({ calc }) => calc.state === 'resolved' && calc.totalForecast != null
  );
  return {
    configuredCount: configured.length,
    resolvedCount: resolved.length,
    forecast:
      resolved.length === configured.length
        ? roundMoney(resolved.reduce((sum, { calc }) => sum + calc.totalForecast, 0))
        : null,
  };
}

export function readyStateLabel(line, draft) {
  if (!line.enabled) return 'Disabled — not instantiated';
  if (line.alreadyApplied) return 'Already on this development';
  const mapped = Boolean(String(draft.costCodeKey || '').trim());
  const money = hasValidAssumption(line, draft);
  if (draft.selected && isLineConfigured(line, draft)) return 'Configured';
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

export function classificationForDraft(draft, semanticGroup, authority) {
  return classifyTemplateMapping(draft.costCodeKey, semanticGroup, authority);
}

/** Compact State-column chips for classification and line-specific timing exceptions. */
export function setupStateChips({
  classification,
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
      .filter((draft) => isLineSaveable(byId.get(draft.templateLineId), draft))
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
