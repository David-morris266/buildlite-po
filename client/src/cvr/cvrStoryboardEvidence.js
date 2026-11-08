import { formatCvrMoney } from './cvrHelpers';

const pence = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : 0;
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
  const unexplained = movement?.unexplained === true || pence(movement?.awaitingExplanation) !== 0;

  if (siteStart || !movement?.comparable) {
    return {
      title: siteStart ? 'Opening commercial position' : 'Current commercial position',
      text: `The governed position is ${formatCvrMoney(row.finalForecast)} EFC, supported by ${formatCvrMoney(row.committed)} commitment, ${formatCvrMoney(row.changeExposure)} change exposure and ${signed(row.commercialAdjustment)} Projected Adjustment.`,
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
      : `Governed commitment evidence changed by ${signed(commitmentMovement)}.`;

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
    bridge = `The authoritative bridge is: ${components}. EFC is now ${formatCvrMoney(row.finalForecast)}.`;
  } else {
    bridge = `The authoritative bridge is: ${components}. EFC remained ${formatCvrMoney(row.finalForecast)}.`;
  }
  if (unexplained) bridge += ' A non-zero remainder is not explained by the recorded movement components.';

  return {
    title: unexplained ? 'EFC movement includes an unexplained remainder'
      : pence(efcMovement) === 0 ? 'Commercial position changed; EFC unchanged' : 'EFC movement explained',
    text: `${commitmentLead} ${bridge}`,
    evidenceCaptured: Boolean(currentEvidence),
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
