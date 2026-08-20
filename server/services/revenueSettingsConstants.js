/**
 * BL-032A — Development revenue settings constants.
 * Recognition policy is persisted but not applied to CVR/pricing in this slice.
 * Default `completion` matches current BL-019 recognised-revenue behaviour.
 */

const REVENUE_RECOGNITION_POLICIES = {
  completion: "completion",
  exchange: "exchange",
};

const DEFAULT_REVENUE_RECOGNITION_POLICY = REVENUE_RECOGNITION_POLICIES.completion;

const DEFAULT_AFFORDABLE_PERCENTAGES = {
  affordableRent: 58,
  sharedOwnership: 72,
  firstHomes: 70,
  additionality: 65,
  discountMarketSale: 70,
  other: 100,
};

const AFFORDABLE_HOUSING_KEYS = Object.keys(DEFAULT_AFFORDABLE_PERCENTAGES);

const DEFAULT_GARAGE_PREMIUMS = {
  none: 0,
  single: 12500,
  double: 22500,
};

const LOCAL_RECORD_SCHEMA_VERSION = 3;

function emptyRevenueStrategy() {
  return {
    openMarket: {
      ratePerFt2: 350,
      effectiveDate: "",
    },
    affordableHousing: { ...DEFAULT_AFFORDABLE_PERCENTAGES },
    garagePremiums: { ...DEFAULT_GARAGE_PREMIUMS },
    updatedAt: null,
  };
}

function emptySettingsDocument() {
  return {
    recognitionPolicy: DEFAULT_REVENUE_RECOGNITION_POLICY,
    revenueStrategy: emptyRevenueStrategy(),
    houseTypePricing: {},
    revenueAdjustments: [],
    recognitionSettings: {},
  };
}

module.exports = {
  REVENUE_RECOGNITION_POLICIES,
  DEFAULT_REVENUE_RECOGNITION_POLICY,
  DEFAULT_AFFORDABLE_PERCENTAGES,
  AFFORDABLE_HOUSING_KEYS,
  DEFAULT_GARAGE_PREMIUMS,
  LOCAL_RECORD_SCHEMA_VERSION,
  emptyRevenueStrategy,
  emptySettingsDocument,
};
