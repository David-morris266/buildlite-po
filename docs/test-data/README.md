# BuildLite test / UAT data

This folder holds spreadsheet packs used for commercial UAT and regression. They are fictional or historic test evidence, not live customer databases.

## Hawthorn Gardens (intended clean UAT model)

Path: `docs/test-data/Hawthorn Gardens UAT/`

Hawthorn Gardens is the **clean fictional known-answer** end-to-end UAT development for BuildLite.

- 24-plot fictional development (BuildLite Homes Ltd / Midlands)
- Master pack plus plot schedule, mapping/negative tests, and subcontract matrices S-HG001–S-HG019
- Designed so BuildLite can be checked against an independent expected commercial/CVR answer
- Permanent regression/UAT material in this repository

It is **not automatically imported**. Using it as the live UAT development is a later task, after persistence work allows a shared server-backed commercial position.

## Test Site 1 (legacy / current evidence)

Path: `docs/test-data/Test Site 1/`

Test Site 1 is **legacy and current historical test evidence** (budget, matrices, ledger CSV, UAT notes). Keep it for existing scripts and past UAT.

It is **not** the new clean commercial test model. Prefer Hawthorn Gardens for new end-to-end UAT.

BL-031C Test Site 1 CVR migration **PASSED**. **BL-031D** authority-on UAT **PASSED**. **BL-031E** snapshot creation UAT **PASSED** and historic freeze UAT **PASSED** on `buildlite_clone` (`dev-1785599776666-zck5pl`). **BL-031F** P02 monthly-cycle UAT **PASSED**. P01 is **locked** v5 with snapshot `aa6839cc-eace-40dd-a011-6ca90afa7980` (9 rows; frozen development committed £2,364,873 / 5231 committed £50,250). P02 is **locked** v3 (`82454b78-04e5-4f89-8289-406f2ce3e1fa`) with snapshot `e8dea429-ff33-4218-81e6-5102bd110a7f` (9 rows; frozen development committed £2,364,903 / 5231 committed £50,280). Clone totals: **2** snapshot headers / **18** rows. CE-0022 +£10 (after P01 lock) and CE-0023 +£20 (during P02) remain approved. P02 QS overlay: accrual £120 / adjustment +£520 / reason `BL-031F P02 monthly-cycle overlay`. Ledger UAT left one batch and two transactions (origin + supported reversal) netting to £0; keep that evidence. Do not re-execute the CVR migration as new work. **BL-032C is COMPLETE.** P03 Draft UAT **PASSED**: P03 exists as **Draft v1** (`804e7777-4249-41a4-9698-9431c8942ebc`) with **9** carried QS rows and **no snapshot**. 5231 carried accrual £120 / adjustment +£520 / reason `BL-031F P02 monthly-cycle overlay`; adjustment history reset. Live P03: Forecast Revenue £10,444,608; Forecast Cost £2,365,423; Gross Profit £8,079,185; Gross Margin 77.4%; Secured £0; Remaining £10,444,608; Plots Sold 0. P01/P02 snapshots unchanged (**2** headers / **18** rows). **P04 does not exist.** Do **not** Submit / Approve & Lock P03 until BL-032D. **BL-032A** authority-on UAT **PASSED** on the same clone: migration `011` applied; no `buildlite_revenue_v1` payload and no localStorage migration execute; one `development_revenue_settings` row `b2157b36-a243-414e-9169-2d192dad8301` left at version **2**, OM **350**, `recognition_policy` **completion**. **BL-032B is COMPLETE.** Same-price Plot 31 UAT **PASSED**: Available → Reserved → Exchanged at £255,100 → Completed at £255,100 → restore. Differing-price Plot 31 UAT **PASSED**: Exchanged at £250,000 vs £255,100 forecast moved development Forecast £10,444,608 → £10,439,508 (−£5,100); Secured £250,000; Remaining £10,189,508; Completion at £250,000 did not double-count; restore returned baseline. Pre-existing Selling Price HTML `step="1000"` rejected £255,100 and was corrected to `step="0.01"`. Plot 31 restored to Available / forecast £255,100 / sellingPrice £0 / dates cleared. Historic P01/P02 Revenue remains unavailable. Keep Wipe locked certs 1–4 as certificate freeze evidence. Do not treat Hawthorn Gardens as started.
