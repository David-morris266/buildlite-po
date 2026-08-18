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

BL-031C Test Site 1 CVR migration **PASSED** on `buildlite_clone` (`dev-1785599776666-zck5pl`, P01 draft, 9 unique inputs). No local ledger existed, so ledger tables remain empty. Runtime CVR/ledger authority remains localStorage until BL-031D. Do not re-execute the migration as new work. Do not touch Wipe certificates/matrix/CEs or Hawthorn Gardens.
