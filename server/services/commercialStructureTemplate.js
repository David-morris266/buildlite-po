const TEMPLATE = Object.freeze({
  key: 'buildlite_housebuilder_v1', version: 1,
  name: 'BuildLite recommended housebuilder structure',
  heads: Object.freeze([
    ['Land', 'LAND'],
    ['Professional Fees', 'PROFESSIONAL_FEES'],
    ['Preliminaries', 'PRELIMINARIES'],
    ['House Build', 'HOUSE_BUILD'],
    ['Plot Works', 'PLOT_WORKS'],
    ['External Works / Infrastructure', 'EXTERNAL_WORKS_INFRASTRUCTURE'],
    ['Sales & Marketing', 'SELLING_COSTS'],
    ['Finance & Legal', 'FINANCE_LEGAL'],
    ['Customer Costs', 'CUSTOMER_COSTS'],
  ].map(([name, buildliteCategory], displayOrder) => Object.freeze({ name, buildliteCategory, displayOrder }))),
});
function getRecommendedCommercialStructureTemplate() { return { ...TEMPLATE, heads: TEMPLATE.heads.map((head) => ({ ...head })) }; }
module.exports = { getRecommendedCommercialStructureTemplate };
