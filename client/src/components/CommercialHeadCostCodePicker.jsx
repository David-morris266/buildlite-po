import { useMemo } from 'react';
import { commercialHeadCostCodeDiscovery } from '../admin/commercialHeadCostCodeDiscovery';
import PrelimsCostCodePicker from './PrelimsCostCodePicker';

const CATEGORY_LABELS = { PRELIMINARIES: 'Preliminaries', SELLING_COSTS: 'Selling Costs' };

export default function CommercialHeadCostCodePicker({ category, structure, codes = [], valueId = '', valueCode = '', onChange, identity = 'id', name, contextKey = '', allowClear = true, disabled = false, onSetUpCommercialStructure = null }) {
  const discovery = useMemo(() => commercialHeadCostCodeDiscovery({ structure, costCodes: codes, category, currentCostCodeId: valueId, currentCostCode: valueCode }), [structure, codes, category, valueId, valueCode]);
  const selectedCode = valueCode || codes.find((code) => code.id === valueId)?.code || '';
  const categoryLabel = CATEGORY_LABELS[category] || category;
  const choose = (code) => {
    if (!code) return onChange?.(null);
    const matches = codes.filter((item) => item.active !== false && item.code === code);
    onChange?.(matches.length === 1 ? (identity === 'code' ? matches[0].code : matches[0].id) : null);
  };
  const missingMessage = discovery.state === 'archived' ? `The ${categoryLabel} BuildLite category is assigned only to an archived Commercial Head.` : discovery.state === 'ambiguous' ? `The ${categoryLabel} BuildLite category is not uniquely assigned to one active Commercial Head.` : `Set a ${categoryLabel} BuildLite category on an active Commercial Head to enable suggestions.`;
  return <div className="commercial-head-cost-code-discovery">
    {discovery.state !== 'ready' ? <div><p className="admin-form__hint" role="status">Commercial Head not configured. {missingMessage}</p>{onSetUpCommercialStructure ? <button type="button" className="btn btn--secondary" onClick={onSetUpCommercialStructure}>Set up Commercial Cost Structure</button> : null}</div> : null}
    {discovery.ready && discovery.suggestedCount === 0 ? <p className="admin-form__hint" role="status">No active Cost Codes are allocated to {discovery.headLabel}.</p> : null}
    {discovery.currentOutsideSuggestedHead ? <p className="admin-form__hint" role="status">Current mapping is outside {discovery.headLabel}; it remains selected until explicitly changed.</p> : null}
    <PrelimsCostCodePicker name={name} options={discovery.suggested} allOptions={discovery.all} scopeLabel={discovery.headLabel || categoryLabel} value={selectedCode} onChange={choose} allowClear={allowClear} disabled={disabled} retainSelectedInSearch={false} contextKey={contextKey} />
  </div>;
}
