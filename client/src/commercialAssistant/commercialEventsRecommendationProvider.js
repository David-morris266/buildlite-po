/**
 * BL-024A.1 — Commercial Events recommendation provider (thin adapter).
 */

import { listCommercialEventsByDevelopment } from '../commercialEvents/commercialEventStore';
import { isActiveRecovery } from '../commercialEvents/commercialEventRecovery';
import { formatSignedCommercialEventValue } from '../commercialEvents/commercialEventPackageValue';
import {
  canShowPotentialContraBanner,
  isRecoveryCommercialEvent,
} from '../commercialEvents/commercialEventRegisterBadges';
import {
  COMMERCIAL_EVENT_STATUSES,
  PACKAGE_VALUE_STATUSES,
} from '../commercialEvents/commercialEventTypes';
import { COMMERCIAL_ASSISTANT_CONFIG } from './commercialAssistantConfig';
import { buildRecommendationFingerprint } from './recommendationFingerprint';
import {
  COMMERCIAL_ASSISTANT_NAVIGATION_KIND,
  RECOMMENDATION_CATEGORY,
  RECOMMENDATION_GENERATED_BY,
  RECOMMENDATION_PRIORITY,
  RECOMMENDATION_SOURCE_MODULE,
} from './commercialAssistantTypes';

export const COMMERCIAL_EVENTS_RULE_ID = {
  outstandingRecovery: 'ce.outstanding-recovery.v1',
  potentialContraCharge: 'ce.potential-contra.v1',
  agedDraftCommercialEvent: 'ce.aged-draft.v1',
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseWhen(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function daysBetween(fromIso, toDate = new Date()) {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 0;
  const diffMs = toDate.getTime() - from.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function buildNavigationTarget(event, developmentId) {
  return {
    kind: COMMERCIAL_ASSISTANT_NAVIGATION_KIND.developmentCommercialEvent,
    developmentId,
    eventId: event.id,
    packageId: event.packageId || null,
  };
}

function buildOutstandingRecoveryRecommendation(event, developmentId, now = new Date()) {
  const absoluteValue = Math.abs(toNumber(event.value));
  const recovered = toNumber(event.recoveredAmount);
  const outstanding = Math.max(0, absoluteValue - recovered);

  return {
    fingerprint: buildRecommendationFingerprint(
      RECOMMENDATION_SOURCE_MODULE.commercialEvents,
      COMMERCIAL_EVENTS_RULE_ID.outstandingRecovery,
      event.id
    ),
    ruleId: COMMERCIAL_EVENTS_RULE_ID.outstandingRecovery,
    type: COMMERCIAL_EVENTS_RULE_ID.outstandingRecovery,
    category: RECOMMENDATION_CATEGORY.actionRequired,
    priority: RECOMMENDATION_PRIORITY.high,
    title: 'Outstanding recovery',
    description: `Approved recovery ${event.eventNumber || event.id} has an outstanding balance that has not yet been recovered.`,
    recommendation: 'Recover on the next certificate or update the recovery status when action is taken.',
    financialImpact: formatSignedCommercialEventValue(-outstanding),
    financialImpactValue: -outstanding,
    sourceModule: RECOMMENDATION_SOURCE_MODULE.commercialEvents,
    sourceRecordId: event.id,
    navigationTarget: buildNavigationTarget(event, developmentId),
    evidence: [
      { label: 'Event', value: event.eventNumber || event.id, recordRef: event.id },
      { label: 'Outstanding', value: formatSignedCommercialEventValue(-outstanding) },
      { label: 'Recovered to date', value: formatSignedCommercialEventValue(recovered) },
    ],
    generatedBy: RECOMMENDATION_GENERATED_BY.rule,
    observedAt: parseWhen(event.updatedAt || event.createdAt) || now.toISOString(),
    createdAt: now.toISOString(),
  };
}

function buildPotentialContraRecommendation(event, developmentId, now = new Date()) {
  const value = toNumber(event.value);

  return {
    fingerprint: buildRecommendationFingerprint(
      RECOMMENDATION_SOURCE_MODULE.commercialEvents,
      COMMERCIAL_EVENTS_RULE_ID.potentialContraCharge,
      event.id
    ),
    ruleId: COMMERCIAL_EVENTS_RULE_ID.potentialContraCharge,
    type: COMMERCIAL_EVENTS_RULE_ID.potentialContraCharge,
    category: RECOMMENDATION_CATEGORY.warning,
    priority: RECOMMENDATION_PRIORITY.medium,
    title: 'Recovery not yet raised against another subcontractor',
    description: `Approved commercial event ${event.eventNumber || event.id} is flagged for recovery from another subcontractor but no linked recovery has been created.`,
    recommendation:
      'Review the payable event and create a linked recovery on the responsible subcontractor package if recovery is still required.',
    financialImpact: formatSignedCommercialEventValue(value),
    financialImpactValue: value,
    sourceModule: RECOMMENDATION_SOURCE_MODULE.commercialEvents,
    sourceRecordId: event.id,
    navigationTarget: buildNavigationTarget(event, developmentId),
    evidence: [
      { label: 'Event', value: event.eventNumber || event.id, recordRef: event.id },
      { label: 'Payable value', value: formatSignedCommercialEventValue(value) },
    ],
    generatedBy: RECOMMENDATION_GENERATED_BY.rule,
    observedAt: parseWhen(event.updatedAt || event.createdAt) || now.toISOString(),
    createdAt: now.toISOString(),
  };
}

function buildAgedDraftRecommendation(event, developmentId, ageDays, now = new Date()) {
  const value = toNumber(event.value);

  return {
    fingerprint: buildRecommendationFingerprint(
      RECOMMENDATION_SOURCE_MODULE.commercialEvents,
      COMMERCIAL_EVENTS_RULE_ID.agedDraftCommercialEvent,
      event.id
    ),
    ruleId: COMMERCIAL_EVENTS_RULE_ID.agedDraftCommercialEvent,
    type: COMMERCIAL_EVENTS_RULE_ID.agedDraftCommercialEvent,
    category: RECOMMENDATION_CATEGORY.information,
    priority: RECOMMENDATION_PRIORITY.low,
    title: 'Draft commercial event awaiting review',
    description: `Draft commercial event ${event.eventNumber || event.id} has remained in draft for ${ageDays} days.`,
    recommendation: 'Review the draft event and submit or close it if no longer required.',
    financialImpact: formatSignedCommercialEventValue(value),
    financialImpactValue: value,
    sourceModule: RECOMMENDATION_SOURCE_MODULE.commercialEvents,
    sourceRecordId: event.id,
    navigationTarget: buildNavigationTarget(event, developmentId),
    evidence: [
      { label: 'Event', value: event.eventNumber || event.id, recordRef: event.id },
      { label: 'Age (days)', value: String(ageDays) },
    ],
    generatedBy: RECOMMENDATION_GENERATED_BY.rule,
    observedAt: parseWhen(event.updatedAt || event.createdAt) || now.toISOString(),
    createdAt: now.toISOString(),
  };
}

export function evaluateOutstandingRecoveryRecommendation(event, developmentId, now = new Date()) {
  if (!event?.id || !developmentId) return null;
  if (!isRecoveryCommercialEvent(event)) return null;
  if (!PACKAGE_VALUE_STATUSES.has(event.status)) return null;
  if (!isActiveRecovery(event)) return null;

  return buildOutstandingRecoveryRecommendation(event, developmentId, now);
}

export function evaluatePotentialContraRecommendation(event, developmentId, now = new Date()) {
  if (!event?.id || !developmentId) return null;
  if (!canShowPotentialContraBanner(event)) return null;

  return buildPotentialContraRecommendation(event, developmentId, now);
}

export function evaluateAgedDraftRecommendation(
  event,
  developmentId,
  {
    thresholdDays = COMMERCIAL_ASSISTANT_CONFIG.draftCommercialEventAgeDays,
    now = new Date(),
  } = {}
) {
  if (!event?.id || !developmentId) return null;
  if (event.status !== COMMERCIAL_EVENT_STATUSES.draft.key) return null;

  const anchor = parseWhen(event.updatedAt || event.createdAt);
  if (!anchor) return null;

  const ageDays = daysBetween(anchor, now);
  if (ageDays < thresholdDays) return null;

  return buildAgedDraftRecommendation(event, developmentId, ageDays, now);
}

export function buildCommercialEventsRecommendations(context = {}, now = new Date()) {
  const developmentId = context.developmentId || null;
  if (!developmentId) return [];

  const recommendations = [];

  for (const event of listCommercialEventsByDevelopment(developmentId)) {
    try {
      const potentialContra = evaluatePotentialContraRecommendation(
        event,
        developmentId,
        now
      );
      if (potentialContra) recommendations.push(potentialContra);

      const agedDraft = evaluateAgedDraftRecommendation(event, developmentId, { now });
      if (agedDraft) recommendations.push(agedDraft);
    } catch {
      // Legacy or malformed records must not break provider evaluation.
    }
  }

  return recommendations;
}

export const commercialEventsRecommendationProvider = {
  id: RECOMMENDATION_SOURCE_MODULE.commercialEvents,
  getRecommendations: buildCommercialEventsRecommendations,
};
