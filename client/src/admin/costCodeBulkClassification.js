import { lookupClassification, indexClassificationsByKey } from './costCodeClassification';

export function filterClassificationCandidates(codes = [], classifications = [], filters = {}) {
  const byKey = indexClassificationsByKey(classifications);
  const text = String(filters.search || '').trim().toLowerCase();
  return codes.filter((code) => {
    const classification = lookupClassification(byKey, code.code);
    if (filters.active !== 'all' && Boolean(code.active) !== (filters.active !== 'inactive')) return false;
    if (filters.commercialHeadId && code.commercialHeadId !== filters.commercialHeadId) return false;
    if (filters.commercialFamilyId && code.commercialFamilyId !== filters.commercialFamilyId) return false;
    if (filters.reportingGroupId && code.reportingGroupId !== filters.reportingGroupId) return false;
    if (filters.semanticGroup === 'UNCLASSIFIED' && classification.exists) return false;
    if (filters.semanticGroup && filters.semanticGroup !== 'UNCLASSIFIED' && classification.semanticGroup !== filters.semanticGroup) return false;
    return !text || `${code.code} ${code.description || ''}`.toLowerCase().includes(text);
  });
}

export function buildClassificationReviewRows(codes, classifications, selectedIds) {
  const byKey=indexClassificationsByKey(classifications);
  return codes.filter(code=>selectedIds.has(code.id)).map(code=>({
    costCodeId:code.id,costCodeKey:code.code,costCodeVersion:Number(code.version),
    classificationVersion:Number(lookupClassification(byKey,code.code).version||0),
  }));
}
