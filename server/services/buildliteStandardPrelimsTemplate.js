/**
 * BL-033D.x.1 — Product-owned BuildLite Standard Prelims Template v1.
 * Application definition. Not tenant DB rows. Tenant APIs must not mutate this.
 * No customer cost codes, no £ rates, no development dates.
 */

const TIME = "TIME";
const LUMP_SUM = "LUMP_SUM";
const SITE_START = "SITE_START";
const FINAL_COMPLETION = "FINAL_COMPLETION";

const BUILDLITE_STANDARD_PRELIMS_VERSION = 1;

const STANDARD_LINES = [
  {
    templateKey: "bl.prelims.v1.site_manager",
    name: "Site Manager",
    description:
      "Employed or appointed site manager for the duration of the job. Core development Prelims. Not head-office overhead.",
    category: "Site staff",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 10,
  },
  {
    templateKey: "bl.prelims.v1.site_supervisor",
    name: "Site Supervisor / Assistant Site Manager",
    description:
      "On-site supervision. Disable on very small sites if one manager is enough. Not a plot-build trade.",
    category: "Site staff",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 20,
  },
  {
    templateKey: "bl.prelims.v1.site_admin",
    name: "Site Administration",
    description:
      "Site office / coordinator time on the development. Not corporate administration.",
    category: "Site staff",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 30,
  },
  {
    templateKey: "bl.prelims.v1.welfare",
    name: "Welfare / Site Accommodation",
    description:
      "Recurring cabin, toilet and canteen hire. Not show homes or plot houses.",
    category: "Welfare & compound",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 40,
  },
  {
    templateKey: "bl.prelims.v1.temp_electrics_standing",
    name: "Temporary Electrics standing / running cost",
    description:
      "Meter, standing charge or generator hire while the site is live. Connection is a separate lump.",
    category: "Temporary services",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 50,
  },
  {
    templateKey: "bl.prelims.v1.temp_electrics_connection",
    name: "Temporary Electrics connection / setup",
    description:
      "One-off temporary electrical connection. Permanent incoming supply is infrastructure, not Prelims.",
    category: "Temporary services",
    suggestedDriver: LUMP_SUM,
    suggestedStartBasis: null,
    suggestedEndBasis: null,
    displayOrder: 60,
  },
  {
    templateKey: "bl.prelims.v1.temp_water_standing",
    name: "Temporary Water standing / running cost",
    description:
      "Temporary water hire or standing charge. Permanent mains laterals are infrastructure.",
    category: "Temporary services",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 70,
  },
  {
    templateKey: "bl.prelims.v1.temp_water_connection",
    name: "Temporary Water connection / setup",
    description: "One-off temporary water connection. Not estate or plot mains.",
    category: "Temporary services",
    suggestedDriver: LUMP_SUM,
    suggestedStartBasis: null,
    suggestedEndBasis: null,
    displayOrder: 80,
  },
  {
    templateKey: "bl.prelims.v1.temp_compound",
    name: "Temporary Compound / Hardstanding",
    description:
      "Temporary compound formation only. Estate roads, plot roads and SUDS are infrastructure.",
    category: "Welfare & compound",
    suggestedDriver: LUMP_SUM,
    suggestedStartBasis: null,
    suggestedEndBasis: null,
    displayOrder: 90,
  },
  {
    templateKey: "bl.prelims.v1.hoarding",
    name: "Hoarding / Perimeter Fencing setup",
    description:
      "Temporary site perimeter. Plot boundary fences and permanent estate fencing are housebuild/external works.",
    category: "Protection & security",
    suggestedDriver: LUMP_SUM,
    suggestedStartBasis: null,
    suggestedEndBasis: null,
    displayOrder: 100,
  },
  {
    templateKey: "bl.prelims.v1.security_manning",
    name: "Security manning / monitoring",
    description: "Guarding or monitoring while the site is live. Installation is a separate lump.",
    category: "Protection & security",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 110,
  },
  {
    templateKey: "bl.prelims.v1.security_install",
    name: "Security installation / setup",
    description: "One-off CCTV or alarm install. Disable if security is manning-only.",
    category: "Protection & security",
    suggestedDriver: LUMP_SUM,
    suggestedStartBasis: null,
    suggestedEndBasis: null,
    displayOrder: 120,
  },
  {
    templateKey: "bl.prelims.v1.cleaning_ongoing",
    name: "Ongoing Site Cleaning",
    description:
      "Recurring site cleaning through the job. Not a housebuild finishing trade.",
    category: "Cleaning & waste",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 130,
  },
  {
    templateKey: "bl.prelims.v1.cleaning_final",
    name: "Final Clean",
    description: "Handover / close-out clean. Company may later split by completion wave.",
    category: "Cleaning & waste",
    suggestedDriver: LUMP_SUM,
    suggestedStartBasis: null,
    suggestedEndBasis: null,
    displayOrder: 140,
  },
  {
    templateKey: "bl.prelims.v1.skips",
    name: "Skips / Waste",
    description:
      "Regular skip exchange and site waste. Demolition or enabling works are not this line.",
    category: "Cleaning & waste",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 150,
  },
  {
    templateKey: "bl.prelims.v1.hs_management",
    name: "Health & Safety / CDM site provision",
    description:
      "Site H&S or CDM provision. A pure professional-fee consultant may belong under Fees instead.",
    category: "H&S & compliance",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 160,
  },
  {
    templateKey: "bl.prelims.v1.testing_inspection",
    name: "Testing / Inspection allowance",
    description:
      "General statutory testing and inspection allowance. Scaffold inspections are a separate line. Scaffold hire is housebuild.",
    category: "H&S & compliance",
    suggestedDriver: LUMP_SUM,
    suggestedStartBasis: null,
    suggestedEndBasis: null,
    displayOrder: 170,
  },
  {
    templateKey: "bl.prelims.v1.scaffold_inspections",
    name: "Scaffold inspections",
    description:
      "Statutory scaffold inspections only. Scaffold hire and design remain housebuild package costs.",
    category: "H&S & compliance",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 180,
  },
  {
    templateKey: "bl.prelims.v1.small_plant",
    name: "Small Plant / Site Equipment",
    description:
      "General site plant and equipment. Crane, scaffold and trade plant stay with build packages.",
    category: "Plant & consumables",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 190,
  },
  {
    templateKey: "bl.prelims.v1.consumables",
    name: "Site Consumables",
    description: "General site sundries. Not housebuild materials.",
    category: "Plant & consumables",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 200,
  },
  {
    templateKey: "bl.prelims.v1.signage",
    name: "Site Signage",
    description:
      "Site identity and statutory notices. Sales flags and show-home boards are selling costs.",
    category: "Identity & comms",
    suggestedDriver: LUMP_SUM,
    suggestedStartBasis: null,
    suggestedEndBasis: null,
    displayOrder: 210,
  },
  {
    templateKey: "bl.prelims.v1.ppe",
    name: "PPE allowance",
    description: "General site PPE allowance. Replenishment can later be changed to TIME by the company.",
    category: "Plant & consumables",
    suggestedDriver: LUMP_SUM,
    suggestedStartBasis: null,
    suggestedEndBasis: null,
    displayOrder: 220,
  },
  {
    templateKey: "bl.prelims.v1.comms",
    name: "Telephone / Data / Communications",
    description: "Site connectivity. Head-office IT is corporate overhead.",
    category: "Identity & comms",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 230,
  },
  {
    templateKey: "bl.prelims.v1.temp_works_recurring",
    name: "General recurring temporary works / site provision",
    description:
      "General temporary works hire that is genuinely Prelims. Package-specific temporary works stay with the trade.",
    category: "Temporary services",
    suggestedDriver: TIME,
    suggestedStartBasis: SITE_START,
    suggestedEndBasis: FINAL_COMPLETION,
    displayOrder: 240,
  },
  {
    templateKey: "bl.prelims.v1.demobilisation",
    name: "Demobilisation",
    description: "End-of-job compound strip-out. Not plot snagging.",
    category: "Close-out",
    suggestedDriver: LUMP_SUM,
    suggestedStartBasis: null,
    suggestedEndBasis: null,
    displayOrder: 250,
  },
];

function cloneStandardLine(line) {
  return {
    templateKey: line.templateKey,
    name: line.name,
    description: line.description,
    category: line.category,
    suggestedDriver: line.suggestedDriver,
    suggestedStartBasis: line.suggestedStartBasis,
    suggestedEndBasis: line.suggestedEndBasis,
    displayOrder: line.displayOrder,
  };
}

function getBuildLiteStandardPrelimsTemplate() {
  return {
    key: "BUILDLITE_STANDARD_PRELIMS_TEMPLATE",
    version: BUILDLITE_STANDARD_PRELIMS_VERSION,
    name: "BuildLite Standard Prelims",
    description:
      "Recommended UK housebuilding Prelims structure. Guidance only — not a chart of accounts and not CVR authority. No customer cost codes and no universal rates.",
    lineCount: STANDARD_LINES.length,
    lines: STANDARD_LINES.map(cloneStandardLine),
  };
}

module.exports = {
  BUILDLITE_STANDARD_PRELIMS_VERSION,
  getBuildLiteStandardPrelimsTemplate,
};
