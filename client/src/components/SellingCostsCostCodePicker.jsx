import CommercialHeadCostCodePicker from './CommercialHeadCostCodePicker';

export default function SellingCostsCostCodePicker({ codes = [], structure, valueId = '', onChange, name, contextKey = '', allowClear = true, onSetUpCommercialStructure = null }) {
  return <CommercialHeadCostCodePicker category="SELLING_COSTS" structure={structure} codes={codes} valueId={valueId} onChange={onChange} name={name} contextKey={contextKey} allowClear={allowClear} onSetUpCommercialStructure={onSetUpCommercialStructure} />;
}
