const TEMPLATE = Object.freeze({
  key: 'buildlite_housebuilder_v1', version: 1,
  name: 'BuildLite recommended housebuilder structure',
  heads: Object.freeze(['Land','Professional Fees','Preliminaries','House Build','Plot Works','External Works / Infrastructure','Sales & Marketing','Finance & Legal','Customer Costs'].map((name, displayOrder) => Object.freeze({ name, displayOrder }))),
});
function getRecommendedCommercialStructureTemplate() { return { ...TEMPLATE, heads: TEMPLATE.heads.map((head) => ({ ...head })) }; }
module.exports = { getRecommendedCommercialStructureTemplate };
