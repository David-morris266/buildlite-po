import { formatCvrMoney } from './cvrHelpers';

const pence = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : 0;
const optionalPence = (value) => value == null || value === '' || !Number.isFinite(Number(value))
  ? null
  : Math.round(Number(value) * 100);
const signed = (value) => {
  const amount = pence(value);
  if (!amount) return formatCvrMoney(0);
  return `${amount > 0 ? '+' : '−'}${formatCvrMoney(Math.abs(amount) / 100)}`;
};

export function commercialEvidenceOf(row) {
  const evidence = row?.displayMetadata?.commercialEvidence;
  return evidence?.captured === true ? evidence : null;
}

function itemKey(item) {
  return `${item?.type || ''}:${item?.id || item?.reference || ''}`;
}

export function commitmentEvidenceChanges(currentEvidence, previousEvidence) {
  if (!currentEvidence?.captured || !previousEvidence?.captured ||
      currentEvidence?.commitment?.reconciliation !== 'reconciled' ||
      previousEvidence?.commitment?.reconciliation !== 'reconciled') return [];
  const previous = new Map((previousEvidence?.commitment?.items || []).map((item) => [itemKey(item), item]));
  return (currentEvidence?.commitment?.items || []).map((item) => ({
    ...item,
    movement: (pence(item.includedAmount) - pence(previous.get(itemKey(item))?.includedAmount)) / 100,
  })).filter((item) => pence(item.movement) !== 0);
}

function exactVariationReference(changes, commitmentMovement) {
  if (changes.length !== 1) return null;
  const matching = changes.filter((item) =>
    item.type === 'variation_order' && pence(item.movement) !== 0
  );
  return matching.length === 1 && pence(matching[0].movement) === pence(commitmentMovement)
    ? matching[0]
    : null;
}

export function buildStoryboardExplanation({ row, movement, siteStart = false } = {}) {
  if (!row) return null;
  const currentEvidence = commercialEvidenceOf(row);
  const previousEvidence = movement?.previousCommercialEvidence || null;
  const commitmentMovement = movement?.bridge?.committed ?? null;
  const allowanceMovement = movement?.bridge?.uncommittedForecast ?? null;
  const efcMovement = movement?.movement ?? null;
  const recordedResidual = optionalPence(movement?.residual);
  const componentPence = [
    optionalPence(movement?.bridge?.systemForecast),
    optionalPence(movement?.bridge?.changeExposure),
    optionalPence(movement?.bridge?.commercialAdjustment),
  ];
  const efcMovementPence = optionalPence(efcMovement);
  const componentsComplete = componentPence.every((value) => value != null) && efcMovementPence != null;
  const derivedResidual = componentsComplete
    ? efcMovementPence - componentPence.reduce((sum, value) => sum + value, 0)
    : null;
  const financialRemainderPence = recordedResidual ?? derivedResidual;
  const reconciliationConfirmed = financialRemainderPence != null;
  const financialUnreconciled = reconciliationConfirmed && financialRemainderPence !== 0;
  const attributionLimited = !financialUnreconciled && (
    pence(movement?.awaitingExplanation) !== 0
  );

  if (siteStart || !movement?.comparable) {
    return {
      title: siteStart ? 'Opening commercial position' : 'Current commercial position',
      text: `EFC is ${formatCvrMoney(row.finalForecast)}, comprising ${formatCvrMoney(row.committed)} committed, ${formatCvrMoney(row.changeExposure)} change exposure and ${signed(row.commercialAdjustment)} Projected Adjustment.`,
      evidenceCaptured: Boolean(currentEvidence),
    };
  }

  const changes = commitmentEvidenceChanges(currentEvidence, previousEvidence);
  const variation = currentEvidence && previousEvidence
    ? exactVariationReference(changes, commitmentMovement) : null;
  const commitmentLead = pence(commitmentMovement) === 0
    ? 'Commitment did not change.'
    : variation
      ? `${variation.reference} ${pence(commitmentMovement) > 0 ? 'increased' : 'reduced'} commitment by ${formatCvrMoney(Math.abs(commitmentMovement))}.`
      : `Commitment changed by ${signed(commitmentMovement)}.`;

  const components = [
    `System Forecast ${signed(movement?.bridge?.systemForecast || 0)}`,
    `Change Exposure ${signed(movement?.bridge?.changeExposure || 0)}`,
    `Projected Adjustment ${signed(movement?.bridge?.commercialAdjustment || 0)}`,
    `EFC ${signed(efcMovement || 0)}`,
  ].join('; ');
  let bridge;
  if (pence(efcMovement) === 0 && pence(commitmentMovement) !== 0 &&
      pence(allowanceMovement) === -pence(commitmentMovement)) {
    bridge = `The existing allowance absorbed the commitment change: Uncommitted moved by ${signed(allowanceMovement)}, so EFC remained ${formatCvrMoney(row.finalForecast)}.`;
  } else if (pence(efcMovement) !== 0) {
    bridge = `${components}. These movements give a current EFC of ${formatCvrMoney(row.finalForecast)}.`;
  } else {
    bridge = `${components}. EFC remained ${formatCvrMoney(row.finalForecast)}.`;
  }
  if (financialUnreconciled) {
    bridge += ` The component movements do not reconcile to the EFC movement; ${signed(financialRemainderPence / 100)} remains to be reviewed.`;
  } else if (!reconciliationConfirmed) {
    bridge += ' Reconciliation cannot be confirmed for this comparison.';
  }

  return {
    title: financialUnreconciled ? 'Forecast movement needs reconciliation'
      : !reconciliationConfirmed ? 'Forecast reconciliation cannot be confirmed'
      : pence(efcMovement) === 0 ? 'Commitment changed; EFC unchanged'
        : pence(efcMovement) > 0 ? `EFC increased by ${formatCvrMoney(efcMovement)}`
          : `EFC reduced by ${formatCvrMoney(Math.abs(efcMovement))}`,
    text: `${commitmentLead} ${bridge}`,
    evidenceCaptured: Boolean(currentEvidence),
    financialUnreconciled,
    reconciliationConfirmed,
    financialRemainder: financialRemainderPence == null ? null : financialRemainderPence / 100,
    attributionLimited,
    evidenceNote: attributionLimited
      ? 'The visible financial movement reconciles. Available historic record evidence is not sufficient to identify one record as the sole cause.'
      : null,
    commitmentChanges: changes,
  };
}

export function buildStoryboardBridge(current, previous) {
  const delta = (field) => (pence(current?.[field]) - pence(previous?.[field])) / 100;
  if (!current || !previous) return null;
  return {
    committed: delta('committed'),
    certified: delta('certified'),
    actualCost: delta('actualCost'),
    currentCost: delta('currentCost'),
    uncommittedForecast: delta('uncommittedForecast'),
    changeExposure: delta('changeExposure'),
    commercialAdjustment: delta('commercialAdjustment'),
    systemForecast: delta('systemForecast'),
    finalForecast: delta('finalForecast'),
  };
}
