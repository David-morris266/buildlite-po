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

BL-031C Test Site 1 CVR migration **PASSED**. **BL-031D** authority-on UAT **PASSED**. **BL-031E** snapshot creation UAT **PASSED** and historic freeze UAT **PASSED** on `buildlite_clone` (`dev-1785599776666-zck5pl`). **BL-031F** P02 monthly-cycle UAT **PASSED**. P01 is **locked** v5 with snapshot `aa6839cc-eace-40dd-a011-6ca90afa7980` (9 rows; frozen development committed £2,364,873 / 5231 committed £50,250). P02 is **locked** v3 (`82454b78-04e5-4f89-8289-406f2ce3e1fa`) with snapshot `e8dea429-ff33-4218-81e6-5102bd110a7f` (9 rows; frozen development committed £2,364,903 / 5231 committed £50,280). Clone totals: **2** snapshot headers / **18** rows. CE-0022 +£10 (after P01 lock) and CE-0023 +£20 (during P02) remain approved. P02 QS overlay: accrual £120 / adjustment +£520 / reason `BL-031F P02 monthly-cycle overlay`. Ledger UAT left one batch and two transactions (origin + supported reversal) netting to £0; keep that evidence. Do not re-execute the CVR migration as new work. **P03 does not exist**; do not create P03 until instructed. **BL-032A** does not migrate Test Site 1 revenue strategy/localStorage and does not apply migration `011` to `buildlite_clone`. Do not treat Hawthorn Gardens as started. Keep Wipe locked certs 1–4 as certificate freeze evidence.
