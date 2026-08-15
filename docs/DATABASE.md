# BuildLite Database Reference

**Current programme:** Doc 67 persistence migration on `buildlite-V1-1` (see `CURRENT_STATE.md`).  
**Last product slice:** BL-028B.3 Commercial Event server authority.  
**NEXT:** BL-029 Order Matrix Persistence (BL-029A schema/API only; client still localStorage).

---

## Current persistence boundary (Doc 67)

Postgres is already the authority for:

| Migration | Tables | Sprint |
|-----------|--------|--------|
| `001`–`003` | clients, brand, jobs, cost_codes, suppliers, purchase_orders, legacy payment_certificates | Phase 0 / BL-006 |
| `004_developments.sql` | `developments` | BL-027A |
| `005_packages.sql` | `packages`, `package_purchase_orders` | BL-027B |
| `006_commercial_events.sql` | `commercial_events`, `commercial_event_audit` | BL-028 |
| `007_package_order_matrices.sql` | `package_order_matrices` | BL-029A schema/API only |

Still **browser/localStorage** (not yet Postgres authority):

- Order matrices — live client still uses localStorage; BL-029A added server persistence/API only. Do not treat BL-029 as complete.
- BuildLite V1 payment certificates (matrix progress, commercial lines, recovery deductions, frozen totals) — **BL-030**
- CVR periods/cost centres and purchase ledger — **BL-031**

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

- Versioned SQL migrations in `server/migrations/` (`001`–`007`; `001`–`003` are the BL-006 production baseline)
- `schema_migrations` tracking table
- `npm run migrate` and `npm run seed` scripts
- `db.js` init aligned with production plus later Doc 67 tables (fallback when migrations have not run)

**Production database was the source of truth for BL-006.** Migrations `001` and `002` are frozen; reconciliation is in `003_reconcile_production.sql`. Do not edit applied migration files. Later Doc 67 migrations (`004`–`007`) are additive and must also not be rewritten after apply.

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
| `007_package_order_matrices.sql` | BL-029A: plot-stage order matrix schema/API (client still localStorage) |

---

## Deploy runbook

From `server/`:

```bash
npm run migrate    # apply pending SQL (001 → … → 007)
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
