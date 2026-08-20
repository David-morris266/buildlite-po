# BuildLite Database Reference

**Current programme:** Doc 67 persistence migration on `buildlite-V1-1` (see `CURRENT_STATE.md`).  
**Last product slice fully complete:** BL-030 Payment Certificate persistence (including BL-030C server authority and passed historical-freeze UAT).  
**Last persistence slice implemented:** **BL-031E.4 banked** — client historic snapshot reads. Test Site 1 lock/freeze UAT has **not** been run. BL-031E is **not** complete.  
**NEXT:** Test Site 1 lock/freeze UAT for **BL-031E**. Do not lock Test Site 1 until instructed. BL-031E is **not** complete.

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
| `010_cvr_period_snapshots.sql` | `cvr_period_snapshots`, `cvr_period_snapshot_rows` | **BL-031E.1** schema. **BL-031E.3B** persists a snapshot atomically on Approve & Lock. **BL-031E.4 banked**: client historic reads from snapshot (or historic-unavailable). UAT not run. Do not backfill legacy locked periods. Local `buildlite_clone` already has 010; do not write snapshots onto Test Site 1 until instructed. |

Still **browser/localStorage** (not yet Postgres authority):

- Revenue, administration master data, setup drafts, Commercial Assistant dispositions

CVR periods/cost centres and purchase ledger are server-authoritative when `VITE_CVR_SERVER_AUTHORITY=true` and `VITE_LEDGER_SERVER_AUTHORITY=true`. Order matrices are server-authoritative when `VITE_MATRIX_SERVER_AUTHORITY=true`. V1 payment certificates are server-authoritative when `VITE_CERTIFICATE_SERVER_AUTHORITY=true`. Do not commit `.env.local`.

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

- Versioned SQL migrations in `server/migrations/` (`001`–`010`; `001`–`003` are the BL-006 production baseline)
- `schema_migrations` tracking table
- `npm run migrate` and `npm run seed` scripts
- `db.js` init aligned with production plus later Doc 67 tables (fallback when migrations have not run)

**Production database was the source of truth for BL-006.** Migrations `001` and `002` are frozen; reconciliation is in `003_reconcile_production.sql`. Do not edit applied migration files. Later Doc 67 migrations (`004`–`010`) are additive and must also not be rewritten after apply.

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

---

## BL-031A tables (server foundation)

These tables persist CVR periods, QS inputs, and purchase ledger batches/transactions. **BL-031D** cut runtime authority to Postgres when flags are ON (no localStorage fallback). **BL-031C** migrated Test Site 1 CVR P01 onto `buildlite_clone` (9 unique inputs). After BL-031D UAT the clone also holds one disposable ledger batch with origin + supported reversal netting to £0. **BL-031E.3B** persists an immutable snapshot atomically when a *new* period is Approved & Locked. Existing locked periods with no snapshot are left untouched for E.4. Test Site 1 P01 has not been locked or snapshotted.

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

The migration is additive and does **not** backfill locked periods. **BL-031E.3B** Approve & Lock now calculates the close candidate and INSERTs header + rows in the same Postgres transaction as `submitted → locked` and CVR audit. There is no UPDATE/UPSERT of historic snapshots. **BL-031E.4** (banked) client historic reads render locked periods from the snapshot only; legacy locked periods with no snapshot are historic-unavailable and must not fall back to live commercial sources. Local `buildlite_clone` already has 010 applied; do not write a Test Site 1 snapshot until instructed. Test Site 1 historic freeze UAT has **not** been run.

**Derived Summary labels:** BL-031D Summary “Certified Not in Ledger” is the same commercial value as Worksheet outstanding certified: `max(0, certified − actual)`. Historic Summary must derive that label from frozen `outstanding_certified`. Do **not** add a second money column. “Committed not certified” is likewise derived from frozen `committed` and `certified`.

**Derived Summary labels:** BL-031D Summary “Certified Not in Ledger” is the same commercial value as Worksheet outstanding certified: `max(0, certified − actual)`. Historic Summary must derive that label from frozen `outstanding_certified`. Do **not** add a second money column. “Committed not certified” is likewise derived from frozen `committed` and `certified`.

---

## Deploy runbook

From `server/`:

```bash
npm run migrate    # apply pending SQL (001 → …). 010 is already on local buildlite_clone from E.3A; do not persist Test Site 1 snapshots until instructed.
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
