# BuildLite Database Reference

**Current programme:** Doc 67 persistence migration on `buildlite-V1-1` (see `CURRENT_STATE.md`).  
**Last product slice fully complete:** **BL-033C.1 — COMPLETE** (explicit CVR reporting-month selection; Test Site 1 reporting-month UAT **PASSED**).  
**Last persistence slice implemented:** **BL-033C** (`014_development_programme.sql` applied on `buildlite_test` and local `buildlite_clone`). **BL-033C.1 COMPLETE** (no new migration). **BL-033A design ACCEPTED.**  
**CRITICAL:** P03 is **locked** with schema-v2 snapshot `0ad18cb8-0b1a-469a-8fa0-10216728150a`. P04 is **Draft** `0f513191-cd25-4812-834f-37dcf66487e0` v1 with `reporting_month` **2026-08** and **no snapshot**. P01/P02/P03 `reporting_month` remain NULL. P05 does not exist.  
**NEXT:** BL-033D is **not started**. Do not Submit or Approve & Lock P04. Do not create P05. Do not switch 5231 to TIME.

---

## Current persistence boundary (Doc 67)

Postgres is already the authority for:

| Migration | Tables | Sprint |
|-----------|--------|--------|
| `001`–`003` | clients, brand, jobs, cost_codes, suppliers, purchase_orders, legacy payment_certificates | Phase 0 / BL-006 |
| `004_developments.sql` | `developments` | BL-027A |
| `005_packages.sql` | `packages`, `package_purchase_orders` | BL-027B |
| `006_commercial_events.sql` | `commercial_events`, `commercial_event_audit` | BL-028 |
| `007_package_order_matrices.sql` | `package_order_matrices` | BL-029 complete (schema/API + client server authority) |
| `008_package_payment_certificates.sql` | `package_payment_certificates`, `package_payment_certificate_audit` | BL-030 fully complete (schema/API + client server authority; historical-freeze UAT passed). |
| `009_cvr_and_purchase_ledger.sql` | `cvr_periods`, `cvr_period_audit`, `cvr_cost_code_inputs`, `ledger_import_batches`, `ledger_transactions` | **BL-031A–D**. Runtime CVR/ledger use Postgres when flags are ON. |
| `010_cvr_period_snapshots.sql` | `cvr_period_snapshots`, `cvr_period_snapshot_rows` | **BL-031E COMPLETE**. Schema (E.1), close engine (E.2), atomic persist on Approve & Lock (E.3), client historic reads (E.4). Test Site 1 snapshot creation UAT **PASSED**. Historic freeze UAT **PASSED**. **BL-031F COMPLETE**: P02 monthly-cycle UAT **PASSED**. **BL-032D COMPLETE**: P03 is the first schema-v2 snapshot. Do not backfill legacy locked periods. |
| `011_development_revenue_settings.sql` | `development_revenue_settings` | **BL-032A COMPLETE**. Typed development revenue strategy/settings. Additive. Default recognition policy `completion` (legacy BL-019 behaviour). `exchange` is stored only; not applied to pricing/CVR. Applied on local `buildlite_clone`. Authority-on UAT **PASSED**. No P01/P02 snapshot backfill. |
| `012_cvr_period_snapshot_revenue.sql` | Revenue columns on `cvr_period_snapshots` + `cvr_period_snapshot_plots` | **BL-032D COMPLETE**. Additive. No default £0. No v1 backfill. Applied on `buildlite_test` and local `buildlite_clone`. Test Site 1 P03 lock/freeze UAT **PASSED**. |
| `013_cost_code_classifications.sql` | `cost_code_classifications` | **BL-033B COMPLETE**. Tenant-level semantic group + forecast-driver metadata. Unmapped = UNCLASSIFIED + STANDARD_CVR (no row). OTHER is explicit. Unique `(client_id, cost_code_key)`. No FK on the text key. No backfill. Applied on `buildlite_test` and local `buildlite_clone`. Test Site 1 `5231` → PRELIMS + STANDARD_CVR. Not in CVR/snapshots. `forecast_driver` is a default/suggested driver only. |
| `014_development_programme.sql` | `development_programme` | **BL-033C COMPLETE**. Typed site start / optional first completion / final completion / plot count + version. GET seeds from payload without write until PUT. Inclusive calendar months in application code. Test Site 1 programme UAT **PASSED** (one v1 row; 38 months; firstCompletion NULL). Applied on `buildlite_test` and local `buildlite_clone`. **BL-033C.1 COMPLETE**: Create Next requires an explicit YYYY-MM (`reportingMonth` is the CVR calendar month, distinct from the period key; no today default; no historic inference). Test Site 1 P04 Draft `reporting_month` **2026-08**; P01–P03 remain NULL. Not in CVR/snapshots. |

Still **browser/localStorage** (not yet Postgres authority):

- Revenue **categories** / administration master data, setup drafts, Commercial Assistant dispositions
- Development revenue **strategy/settings** (`buildlite_revenue_v1`) unless `VITE_REVENUE_SERVER_AUTHORITY=true` (BL-032A COMPLETE; default OFF; Test Site 1 authority-on UAT **PASSED**)
- Plot-level commercial fields remain on `developments.payload` (not moved in BL-032A). BL-032B stores `reservedAt` / `exchangedAt` / `completedAt` on that payload only.
- Cost-code **master records** remain browser `buildlite_cost_codes_master_v1`. BL-033B classification metadata is **server-authoritative** (`cost_code_classifications`) and is not stored in that master.

CVR periods/cost centres and purchase ledger are server-authoritative when `VITE_CVR_SERVER_AUTHORITY=true` and `VITE_LEDGER_SERVER_AUTHORITY=true`. Order matrices are server-authoritative when `VITE_MATRIX_SERVER_AUTHORITY=true`. V1 payment certificates are server-authoritative when `VITE_CERTIFICATE_SERVER_AUTHORITY=true`. Development revenue settings are server-authoritative when `VITE_REVENUE_SERVER_AUTHORITY=true` (default OFF). Do not commit `.env.local`.

The legacy `payment_certificates` / `payment_certificate_lines` tables below are **not** the V1 React certificate engine. Do not merge those models merely because a certificate table already exists (Doc 67 §21).

Automated server tests must use isolated `TEST_DATABASE_URL` / `buildlite_test`. Do not run them against `buildlite_clone`.

---

## BL-006 historical catalogue (preserved)

**Last updated (this section):** BL-006 Production Schema Reconciliation  
**Authority:** Render production clone inspection (Jun 2026)  
**Track:** A — JSON purchase orders retained (Phase 3A); Doc 22 relational PO model deferred

The remainder of this file is the Phase 0 / BL-006 production schema reference. It remains valid as the baseline for the original eight production tables. It does not describe developments, packages, or commercial events.

---

## Overview

BuildLite uses a single Postgres database (`buildlite_po_db` on Render). Schema is managed via:

- Versioned SQL migrations in `server/migrations/` (`001`–`014`; `001`–`003` are the BL-006 production baseline). `011`, `012`, `013`, and `014` are applied on local clone.
- `schema_migrations` tracking table
- `npm run migrate` and `npm run seed` scripts
- `db.js` init aligned with production plus later Doc 67 tables (fallback when migrations have not run)

**Production database was the source of truth for BL-006.** Migrations `001` and `002` are frozen; reconciliation is in `003_reconcile_production.sql`. Do not edit applied migration files. Later Doc 67 migrations (`004`–`014`) are additive and must also not be rewritten after apply. `013` is additive and **applied** on local `buildlite_clone`. Test Site 1 classification UAT **PASSED**. `014` is additive and **applied** on local `buildlite_clone`. Test Site 1 programme UAT **PASSED**.

---

## Production tables (8)

| Table | Purpose | Notes |
|-------|---------|-------|
| `clients` | Tenant / organisation | UUID PK; one `is_active = true` |
| `client_brand_profiles` | Branding per client | Flat TEXT columns (company details, logo, accent colour) |
| `cost_codes` | Cost code master data | Scoped by `client_id`; unique `(client_id, code)` |
| `jobs` | Project/job register | Serial PK; `client_id` for tenant scope |
| `suppliers` | Supplier master (JSON payload) | PK `id` (TEXT); `client_id` for scoping |
| `purchase_orders` | PO documents (JSON payload) | PK `po_number`; `payload` JSONB; `client_id` |
| `payment_certificates` | Payment certs (hybrid model) | `legacy_cert_no` + `payload` JSONB for lines |
| `payment_certificate_lines` | Legacy line table | **Exists in production; deprecated for new deploys** |

### Operational table

| Table | Purpose |
|-------|---------|
| `schema_migrations` | Applied migration filenames |

---

## clients

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK, default `gen_random_uuid()` |
| `code` | TEXT | NOT NULL, UNIQUE |
| `name` | TEXT | NOT NULL |
| `is_active` | BOOLEAN | NOT NULL, default `false` |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` |

Production does **not** have `updated_at`. Environments that ran `001_baseline.sql` before BL-006 may retain that extra column (harmless).

---

## client_brand_profiles

| Column | Type | Notes |
|--------|------|-------|
| `client_id` | UUID | PK, FK → `clients.id` |
| `legal_name` | TEXT | |
| `trading_name` | TEXT | |
| `company_number` | TEXT | |
| `vat_number` | TEXT | |
| `address_line1` | TEXT | |
| `address_line2` | TEXT | |
| `town` | TEXT | |
| `county` | TEXT | |
| `postcode` | TEXT | |
| `phone` | TEXT | |
| `email` | TEXT | |
| `website` | TEXT | |
| `pdf_footer_text` | TEXT | |
| `logo_url` | TEXT | |
| `accent_color` | TEXT | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` |

Seed inserts `(client_id)` only; all other columns are nullable.

---

## cost_codes

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `client_id` | UUID | NOT NULL, FK → `clients.id` |
| `code` | TEXT | NOT NULL; unique with `client_id` |
| `sub_heading` | TEXT | |
| `trade` | TEXT | |
| `element` | TEXT | |
| `is_active` | BOOLEAN | NOT NULL, default `true` |

Production does **not** have `created_at` / `updated_at`.

---

## jobs

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL | PK |
| `job_code` | TEXT | |
| `job_number` | TEXT | |
| `name` | TEXT | |
| `site_address` | TEXT | |
| `site_manager` | TEXT | |
| `site_phone` | TEXT | |
| `notes` | TEXT | |
| `created_at` | TIMESTAMPTZ | NOT NULL |
| `updated_at` | TIMESTAMPTZ | NOT NULL |
| `client_id` | UUID | FK → `clients.id`; routes filter by active client |

---

## purchase_orders (current model)

| Column | Type | Notes |
|--------|------|-------|
| `po_number` | TEXT | Primary key (global; tenant composite in `002`) |
| `payload` | JSONB | Full PO document |
| `client_id` | UUID | FK → `clients.id` |

---

## payment_certificates (hybrid model)

Production authority for certificate numbering is **`legacy_cert_no`**, enforced by unique index `ux_paycert_client_job_supplier_no`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `client_id` | UUID | NOT NULL in production; FK → `clients.id` |
| `job_id` | TEXT | Nullable in production |
| `supplier_id` | TEXT | Nullable in production |
| `legacy_cert_no` | INTEGER | NOT NULL; per client+job+supplier sequence |
| `legacy_period_end` | DATE | Production period end |
| `status` | TEXT | e.g. Draft |
| `payload` | JSONB | Lines, settings, deductions |
| `created_at` / `updated_at` | TIMESTAMPTZ | Audit timestamps |
| `certificate_number` | INTEGER | Alias; backfilled from `legacy_cert_no` |
| `cert_no` | INTEGER | Legacy alias |
| `period_from` | DATE | |
| `period_to` | DATE | Alias |
| `period_end` | DATE | Legacy alias |
| `notes` | TEXT | |

**Lines storage:** Primary path is `payload.lines[]` JSONB. `payment_certificate_lines` exists in production but is not used by current routes.

---

## Indexes

| Index | Table | Columns |
|-------|-------|---------|
| `idx_clients_is_active` | `clients` | `(is_active) WHERE is_active` |
| `idx_purchase_orders_client_id` | `purchase_orders` | `(client_id)` |
| `idx_suppliers_client_id` | `suppliers` | `(client_id)` |
| `idx_cost_codes_client` | `cost_codes` | `(client_id)` |
| `idx_cost_codes_client_active_code` | `cost_codes` | `(client_id, is_active, code)` |
| `idx_payment_certificates_client_job_supplier` | `payment_certificates` | `(client_id, job_id, supplier_id)` |
| `ix_paycert_client` | `payment_certificates` | `(client_id)` |
| `ix_paycert_client_job` | `payment_certificates` | `(client_id, job_id)` |
| `ix_paycert_client_supplier` | `payment_certificates` | `(client_id, supplier_id)` |
| `ux_paycert_client_job_supplier_no` | `payment_certificates` | `(client_id, job_id, supplier_id, legacy_cert_no)` UNIQUE |

### From `002_tenant_keys.sql`

| Index | Columns |
|-------|---------|
| `uq_purchase_orders_client_po_number` | `(client_id, po_number)` WHERE `client_id IS NOT NULL` |
| `uq_suppliers_client_id` | `(client_id, id)` WHERE `client_id IS NOT NULL` |
| `idx_jobs_client_id` | `(client_id)` |

---

## Migration history

| File | Purpose |
|------|---------|
| `001_baseline.sql` | Phase 0 additive baseline (frozen) |
| `002_tenant_keys.sql` | Tenant keys + `jobs.client_id` (frozen) |
| `003_reconcile_production.sql` | BL-006: align with Render production schema |
| `004_developments.sql` | BL-027A: server-backed developments |
| `005_packages.sql` | BL-027B: packages + package PO membership |
| `006_commercial_events.sql` | BL-028A: commercial events + CE audit |
| `007_package_order_matrices.sql` | BL-029: plot-stage order matrix schema/API; client server-authority cutover in BL-029D |
| `008_package_payment_certificates.sql` | BL-030A: V1 package_payment_certificates + audit (does not alter legacy payment_certificates); client server-authority cutover in BL-030C |
| `009_cvr_and_purchase_ledger.sql` | BL-031A: CVR periods + QS cost-code inputs + purchase ledger batches/transactions (server foundation only; snapshots are BL-031E) |
| `010_cvr_period_snapshots.sql` | BL-031E.1: CVR period snapshot header + rows. Additive; no backfill of locked periods. Runtime persist is BL-031E.3B (atomic Approve & Lock). |
| `011_development_revenue_settings.sql` | BL-032A: one typed revenue strategy/settings row per development. Additive. Default `recognition_policy = completion`. COMPLETE. Applied on local `buildlite_clone`. Test Site 1 authority-on UAT **PASSED**. |
| `012_cvr_period_snapshot_revenue.sql` | BL-032D: whole-CVR Revenue snapshot columns + plot rows. Additive. No default £0. No v1 backfill. COMPLETE. Applied on `buildlite_test` and local `buildlite_clone`. Test Site 1 P03 lock/freeze UAT **PASSED**. |

---

## BL-031A tables (server foundation)

These tables persist CVR periods, QS inputs, and purchase ledger batches/transactions. **BL-031D** cut runtime authority to Postgres when flags are ON (no localStorage fallback). **BL-031C** migrated Test Site 1 CVR P01 onto `buildlite_clone` (9 unique inputs). After BL-031D UAT the clone also holds one disposable ledger batch with origin + supported reversal netting to £0. **BL-031E** persists an immutable snapshot atomically when a period is Approved & Locked. Test Site 1 P01 is locked with snapshot `aa6839cc-eace-40dd-a011-6ca90afa7980` (9 rows). **BL-031F** locked P02 with snapshot `e8dea429-ff33-4218-81e6-5102bd110a7f` (9 rows). **BL-032D** locked P03 with schema-v2 snapshot `0ad18cb8-0b1a-469a-8fa0-10216728150a` (9 cost rows + 31 Revenue plot rows). Clone snapshot totals are **3** headers / **27** cost rows / **31** Revenue plot rows. Existing locked periods with no snapshot remain historic-unavailable (no live fallback).

Agreed future commercial rules (do **not** change live client calculations in BL-031A):

- Current commitment = approved PO net + approved value-changing Commercial Events
- CVR certified cost ≈ matrix works certified + certified CE inclusions + signed recoveries/contras (exclude retention and VAT; not certificate net payment)
- Ledger actual for CVR = **SUM(net)** (VAT stored as evidence only)
- `manual_accrual` is a QS-entered input, distinct from outstanding certified
- Snapshot occurs on approve/lock in BL-031E.3B for newly locked periods; V1 does not reopen locked CVRs

| Table | Purpose |
|-------|---------|
| `cvr_periods` | One reporting period per development. Unique `(client_id, development_id, lower(period_key))`. Status `draft` → `submitted` → `locked`. At most one open (`draft` or `submitted`) period per development. |
| `cvr_period_audit` | Workflow/edit evidence (created, patched, submitted, rejected, approved, locked, inputs_upserted). |
| `cvr_cost_code_inputs` | QS overlays per period × `cost_code_key`, including `manual_accrual NUMERIC NOT NULL DEFAULT 0`. Unique `(client_id, period_id, cost_code_key)`. |
| `ledger_import_batches` | Import provenance (file, profile, row counts, total net). |
| `ledger_transactions` | Transaction-level actuals. Unique `(client_id, development_id, fingerprint)`. Optional `reverses_id`. |

No snapshot tables in `009`. Legacy `payment_certificates` and BL-029/BL-030 matrix/certificate tables are unchanged.

---

## BL-031E snapshot tables

Migration `010_cvr_period_snapshots.sql` adds:

| Table | Purpose |
|-------|---------|
| `cvr_period_snapshots` | One frozen CVR close header per tenant period. Unique `(client_id, period_id)`. `period_id` is `ON DELETE RESTRICT` so deleting a CVR period cannot wipe history. |
| `cvr_period_snapshot_rows` | Frozen per-cost-code commercial position. Unique `(snapshot_id, cost_code_key)`. Rows cascade when their snapshot is deleted. |

The migration is additive and does **not** backfill locked periods. **BL-031E.3** Approve & Lock calculates the close candidate and INSERTs header + rows in the same Postgres transaction as `submitted → locked` and CVR audit. There is no UPDATE/UPSERT of historic snapshots. **BL-031E.4** client historic reads render locked periods from the snapshot only; legacy locked periods with no snapshot are historic-unavailable and must not fall back to live commercial sources.

**BL-031E UAT (PASSED) on `buildlite_clone` Test Site 1 P01:** snapshot id `aa6839cc-eace-40dd-a011-6ca90afa7980`, schema version 1, 9 rows, P01 locked v5. Frozen development committed **£2,364,873**; frozen 5231 committed **£50,250**. After lock, approved **CE-0022** Variation +£10 (`BL-031E historic freeze UAT`) moved live committed; the P01 snapshot did not move.

**BL-031F UAT (PASSED) on `buildlite_clone` Test Site 1 P02:** period `82454b78-04e5-4f89-8289-406f2ce3e1fa`, locked v3, snapshot `e8dea429-ff33-4218-81e6-5102bd110a7f`, 9 rows. Create Next Period carried QS overlays from persisted inputs (history reset). **CE-0023** Variation +£20 during P02. Frozen P02 development committed **£2,364,903** / final forecast **£2,365,423**; frozen 5231 committed **£50,280** / accrual **£120** / adjustment **+£520** / final forecast **£50,800**. P01 snapshot unchanged. Clone snapshot totals **2** headers / **18** rows. **BL-032C later created P03 Draft** from this locked P02 without adding a snapshot or rewriting P01/P02.

**Derived Summary labels:** BL-031D Summary “Certified Not in Ledger” is the same commercial value as Worksheet outstanding certified: `max(0, certified − actual)`. Historic Summary must derive that label from frozen `outstanding_certified`. Do **not** add a second money column. “Committed not certified” is likewise derived from frozen `committed` and `certified`.

---

## BL-032A development revenue settings

Migration `011_development_revenue_settings.sql` adds:

| Table | Purpose |
|-------|---------|
| `development_revenue_settings` | One revenue strategy/settings row per tenant development. Unique `(client_id, development_id)` and unique `development_id`. `recognition_policy` is `completion` (default, live BL-019 behaviour) or `exchange` (persisted only; not applied in BL-032A). JSONB columns hold `strategy`, `house_type_pricing`, `revenue_adjustments`, and `recognition_settings`. Optimistic `version`. Cascades when the development or client is deleted. |

GET `/api/developments/:developmentId/revenue/settings` returns `exists: false` / `version: 0` / completion defaults without inserting. PUT creates on first write when `version === 0`, then optimistic-locks. Settings persistence is **not** a CVR snapshot. Live Draft/Submitted CVR compose of Revenue is BL-032C. Snapshot freeze of Revenue is BL-032D COMPLETE (schema v2; P03 lock/freeze UAT **PASSED**). Historic P01/P02 must not be backfilled with revenue. `recognition_policy = exchange` is stored only; it is **not** live recognition behaviour.

**BL-032A authority-on UAT (PASSED) on `buildlite_clone` Test Site 1:** migration `011` applied (additive; no backfill). No `buildlite_revenue_v1` payload; live helper `preflight → NO_LOCAL`; migration execute was **not** run. Flag ON only in ignored `client/.env.local`. Initial GET `exists: false` / `version: 0` created no row. First UI write (OM £350 → £351, Save Strategy → No) created row `b2157b36-a243-414e-9169-2d192dad8301` at version 1, policy `completion`. Hard refresh and a second browser session returned 351 from Postgres; `buildlite_revenue_v1` stayed null. Restore £351 → £350 advanced the same row to version 2. Final evidence row: version **2**, OM **350**, AH 58/72/70/65/70/100, garage 0/12500/22500, empty house-type pricing / adjustments / recognitionSettings. Plot 31 stored `forecastSellingPrice` **£255,100** unchanged. Recognised revenue **£0** (Completed-only). P01 locked v5 snapshot `aa6839cc-eace-40dd-a011-6ca90afa7980` and P02 locked v3 snapshot `e8dea429-ff33-4218-81e6-5102bd110a7f` unchanged (**2** headers / **18** rows). P03 was later created as Draft under BL-032C. Do not delete the settings row.

**BL-032B COMPLETE (same-price and differing-price Plot 31 UATs PASSED):** Same-price: Available → Reserved → Exchanged at **£255,100** → Completed at **£255,100** → restore. Forecast unchanged at exchange-equals-forecast; Secured £255,100; Remaining reduced by £255,100; Completion did not double-count. Differing-price: Exchanged at **£250,000** vs £255,100 forecast moved development Forecast **£10,444,608 → £10,439,508** (−£5,100); Secured £250,000; Remaining £10,189,508; Plots Sold 1; Completion at £250,000 did not double-count; restore returned Forecast £10,444,608 / Secured £0. Pre-existing Selling Price HTML `step="1000"` rejected £255,100; corrected to `step="0.01"` in `3ad984adaab3f6b482ee614d92cb29749bd24180`. Plot 31 restored to Available / forecast £255,100 / sellingPrice £0 / dates cleared. Settings row still version 2 / OM 350 / completion. P01/P02 snapshots unchanged. Revenue was **not** in CVR in this slice.

**BL-032C COMPLETE (Test Site 1 P03 Draft UAT PASSED).** Live Draft/Submitted CVR composes the existing Revenue engine with existing CVR `finalForecast` (Forecast / Secured / Remaining Revenue, Forecast Cost, Gross Profit, Gross Margin % to 1 d.p., Plots Sold). GP = Forecast Revenue − `finalForecast`. Revenue is **not** added to `cvrEngine.js`; close-engine keys and Portfolio remain cost-only. Locked v1 P01/P02 remain Revenue/GP/Margin unavailable (no live fallback). P03 Draft `804e7777-4249-41a4-9698-9431c8942ebc` exists with **9** carried QS rows and **no snapshot**. Live P03: Forecast Revenue **£10,444,608** / Forecast Cost **£2,365,423** / Gross Profit **£8,079,185** / Gross Margin **77.4%** / Secured **£0** / Remaining **£10,444,608** / Plots Sold **0**. These live Draft values are **not** stored in a CVR snapshot. P01 snapshot `aa6839cc-eace-40dd-a011-6ca90afa7980` and P02 snapshot `e8dea429-ff33-4218-81e6-5102bd110a7f` unchanged (**2** headers / **18** rows). At that UAT P04 did not exist.

**BL-032D COMPLETE (Test Site 1 P03 whole-CVR lock/freeze UAT PASSED).** Migration `012` applied to local `buildlite_clone`. P03 `804e7777-4249-41a4-9698-9431c8942ebc` is **locked** v3 with first schema-v2 snapshot `0ad18cb8-0b1a-469a-8fa0-10216728150a`. Frozen: Forecast Revenue **£10,444,608** / Secured **£0** / Remaining **£10,444,608** / Plots Sold **0** / Remaining **31** / Forecast Cost **£2,365,423** / GP **£8,079,185** / Margin **77.3527%**; **9** cost rows; **31** Revenue plot rows. Frozen Plot 31 Available / forecast **£255,100** / sellingPrice NULL. Assumptions: settings `b2157b36-a243-414e-9169-2d192dad8301` version **2**, OM **350**, `completion`. P01/P02 remain schema-v1 with Revenue NULL and **0** plot rows. Clone totals **3** headers / **27** cost rows / **31** plot rows. Historic freeze **PASSED** (live Plot Master changed after lock; snapshot did not move). Live Revenue restored to Forecast £10,444,608 / Secured £0. Live Plot 31 Available / forecast £255,100 / dates empty; leftover live `sellingPrice` £255,100 does not move Available KPIs. At that UAT P04 did not exist.

**BL-033C.1 COMPLETE (Test Site 1 reporting-month UAT PASSED).** Create Next requires an explicit YYYY-MM (`reportingMonth` is calendar meaning beside the period key; no today default; no period-key inference; no historic backfill). P04 Draft `0f513191-cd25-4812-834f-37dcf66487e0` v1, `reporting_month` **2026-08**, **9** QS rows, no snapshot. P01/P02/P03 `reporting_month` remain NULL. P05 does not exist. Future BL-033D TIME/LUMP_SUM may use open CVR `reportingMonth` as default `forecastAsAt`. No Prelims engine exists yet.

---

## Deploy runbook

From `server/`:

```bash
npm run migrate    # apply pending SQL (001 → …). 010, 011 and 012 are already on local buildlite_clone. Test Site 1 P01, P02 and P03 snapshots already exist from BL-031E/F and BL-032D UAT; do not recreate them. P03 is locked; do not create P04 in this slice. Test Site 1 revenue settings row (version 2) is BL-032A UAT evidence; do not delete it.
npm run seed       # default client, cost codes, brand profile, client_id backfill
npm start          # start API (calls db.init as fallback)
```

Render: run `migrate` and `seed` before or as part of deploy. Set `NODE_ENV=production` and `DATABASE_SSL=true`.

Local: set `DATABASE_SSL=false`.

| Variable | Local | Render |
|----------|-------|--------|
| `DATABASE_URL` | `postgresql://…@localhost:5432/…` | Render internal or external URL |
| `DATABASE_SSL` | `false` | `true` |

---

## Verification SQL

### Row counts

```sql
SELECT 'clients' AS tbl, COUNT(*) FROM clients
UNION ALL SELECT 'client_brand_profiles', COUNT(*) FROM client_brand_profiles
UNION ALL SELECT 'purchase_orders', COUNT(*) FROM purchase_orders
UNION ALL SELECT 'suppliers', COUNT(*) FROM suppliers
UNION ALL SELECT 'cost_codes', COUNT(*) FROM cost_codes
UNION ALL SELECT 'jobs', COUNT(*) FROM jobs
UNION ALL SELECT 'payment_certificates', COUNT(*) FROM payment_certificates
UNION ALL SELECT 'payment_certificate_lines', COUNT(*) FROM payment_certificate_lines;
```

### client_id backfill check

```sql
SELECT COUNT(*) FILTER (WHERE client_id IS NULL) AS po_unscoped FROM purchase_orders;
SELECT COUNT(*) FILTER (WHERE client_id IS NULL) AS sup_unscoped FROM suppliers;
```

### Schema reconciliation check

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'client_brand_profiles' ORDER BY ordinal_position;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'payment_certificates'
  AND column_name IN ('legacy_cert_no', 'legacy_period_end')
ORDER BY column_name;
```

### Collision checks (gate for `002`)

```sql
SELECT po_number, COUNT(DISTINCT client_id) AS clients
FROM purchase_orders
WHERE client_id IS NOT NULL
GROUP BY po_number
HAVING COUNT(DISTINCT client_id) > 1;

SELECT id, COUNT(DISTINCT client_id) AS clients
FROM suppliers
WHERE client_id IS NOT NULL
GROUP BY id
HAVING COUNT(DISTINCT client_id) > 1;
```

---

## Rollback

No automatic down migrations. Restore from `pg_dump` backup if migration fails or data is wrong. See `docs/phase0/migration-run-log.md`.
