function isActive(value) {
  return value?.active !== false;
}

function hierarchyContext(structure, code) {
  const head = structure?.heads?.find((item) => item.id === code.commercialHeadId);
  const family = structure?.families?.find((item) => item.id === code.commercialFamilyId);
  const group = structure?.reportingGroups?.find((item) => item.id === code.reportingGroupId);
  return [head?.name, family?.name, group?.name].filter(Boolean).join(' → ');
}

export function commercialHeadCostCodeDiscovery({ structure, costCodes = [], category, currentCostCodeId = '', currentCostCode = '' } = {}) {
  const assignedHeads = (structure?.heads || []).filter((head) => head.buildliteCategory === category);
  const activeHeads = assignedHeads.filter(isActive);
  const state = activeHeads.length === 1 ? 'ready' : activeHeads.length > 1 ? 'ambiguous' : assignedHeads.length ? 'archived' : 'missing';
  const head = state === 'ready' ? activeHeads[0] : null;
  const all = costCodes.filter(isActive).map((code) => {
    const context = hierarchyContext(structure, code);
    return { ...code, hierarchyContext: context, reportingGroup: context || code.reportingGroup || '' };
  });
  const current = all.find((code) => (currentCostCodeId && code.id === currentCostCodeId) || (currentCostCode && code.code === currentCostCode));
  const members = head ? all.filter((code) => code.commercialHeadId === head.id) : [];
  const currentOutsideSuggestedHead = Boolean(current && head && current.commercialHeadId !== head.id);
  const retainCurrent = Boolean(current && (!head || currentOutsideSuggestedHead));
  return {
    state,
    ready: state === 'ready',
    head,
    headLabel: head?.name || '',
    all,
    suggested: retainCurrent ? [{ ...current, outsideSuggestedHead: currentOutsideSuggestedHead }, ...members] : members,
    suggestedCount: members.length,
    current,
    currentOutsideSuggestedHead,
  };
}
