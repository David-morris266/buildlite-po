export const normaliseDetailedSellingCostsLines = (lines = []) => lines.map(line => ({
  ...line,
  destinationCostCodeId: line.destinationOverridden
    ? (line.destinationCostCodeId ?? line.destination?.id ?? null)
    : null,
}));

export const buildDetailedSellingCostsSaveLines = (lines = []) => normaliseDetailedSellingCostsLines(lines).map(line => ({
  templateLineId: line.id || line.templateLineId,
  driver: line.forecastDriver || line.driver,
  percent: line.percent,
  lumpSum: line.lumpSum,
  quantity: line.quantity,
  rate: line.rate,
  quantitySource: line.quantitySource,
  unitCode: line.unitCode,
  customUnitLabel: line.customUnitLabel,
  assumptionOverridden: Boolean(line.assumptionOverridden),
  destinationOverridden: Boolean(line.destinationOverridden),
  destinationCostCodeId: line.destinationOverridden ? line.destinationCostCodeId : null,
}));
