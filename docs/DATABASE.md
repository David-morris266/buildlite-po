# BuildLite Database Reference (Phase 0)

**Last updated:** Phase 0 implementation  
**Authority:** Doc 20 Appendix A (live production inspection, 23 Jun 2026)  
**Track:** A — JSON purchase orders retained (Phase 3A); Doc 22 relational PO model deferred

---

## Overview

BuildLite uses a single Postgres database (`buildlite_po_db` on Render). Phase 0 introduces:

- Versioned SQL migrations in `server/migrations/`
- `schema_migrations` tracking table
- `npm run migrate` and `npm run seed` scripts
- `db.js` init aligned with production (fallback for fresh deploy)

**Migrations are the source of truth.** Do not edit applied migration files.

---

## Production tables (8)

| Table | Purpose | Phase 0 notes |
|-------|---------|---------------|
| `clients` | Tenant / organisation | UUID PK; one `is_active = true` |
| `client_brand_profiles` | Branding per client | JSONB `brand`; optional `logo_url` |
| `cost_codes` | Cost code master data | Scoped by `client_id`; unique `(client_id, code)` |
| `jobs` | Project/job register | Serial PK; `client_id` added in `002` (conditional) |
| `suppliers` | Supplier master (JSON payload) | PK `id` (TEXT); `client_id` for scoping |
| `purchase_orders` | PO documents (JSON payload) | PK `po_number`; `payload` JSONB; `client_id` |
| `payment_certificates` | Payment certs (hybrid model) | Header columns + `payload` JSONB for lines |
| `payment_certificate_lines` | Legacy line table | **Exists in production; deprecated for new deploys** — not created by `db.js` init |

### Operational table

| Table | Purpose |
|-------|---------|
| `schema_migrations` | Applied migration filenames |

---

## purchase_orders (current model)

Phase 0 **does not** add Doc 22 relational header/line columns.

| Column | Type | Notes |
|--------|------|-------|
| `po_number` | TEXT | Primary key (global; tenant composite in `002`) |
| `payload` | JSONB | Full PO document (items, job, supplier, approval, etc.) |
| `client_id` | UUID | FK → `clients.id` |

---

## payment_certificates (hybrid model)

Production uses canonical column names. Routes were aligned in Phase 0.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `client_id` | UUID | Tenant scope |
| `job_id` | TEXT | References job (serial id as text) |
| `supplier_id` | TEXT | Supplier PK |
| `certificate_number` | INTEGER | Per client+job+supplier sequence |
| `period_from` | DATE | Valuation period start |
| `period_to` | DATE | Valuation period end |
| `status` | TEXT | e.g. Draft |
| `notes` | TEXT | Optional |
| `payload` | JSONB | Lines, settings, deductions |
| `created_at` / `updated_at` | TIMESTAMPTZ | Audit timestamps |

**Legacy columns** (`cert_no`, `period_end`) may exist in older environments. Migration `001` backfills `certificate_number` / `period_to` from them. API responses include both canonical and legacy alias fields.

**Lines storage:** Primary path is `payload.lines[]` JSONB. `payment_certificate_lines` table exists in production but is not used by current routes.

---

## Indexes (Phase 0)

| Index | Table | Columns |
|-------|-------|---------|
| `idx_clients_is_active` | `clients` | `(is_active) WHERE is_active` |
| `idx_purchase_orders_client_id` | `purchase_orders` | `(client_id)` |
| `idx_suppliers_client_id` | `suppliers` | `(client_id)` |
| `idx_cost_codes_client_active_code` | `cost_codes` | `(client_id, is_active, code)` |
| `idx_payment_certificates_client_job_supplier` | `payment_certificates` | `(client_id, job_id, supplier_id)` |

### Conditional (`002_tenant_keys.sql`)

| Index | Columns |
|-------|---------|
| `uq_purchase_orders_client_po_number` | `(client_id, po_number)` WHERE `client_id IS NOT NULL` |
| `uq_suppliers_client_id` | `(client_id, id)` WHERE `client_id IS NOT NULL` |
| `idx_jobs_client_id` | `(client_id)` |

**Gate:** Apply `002` only when Doc 20 §8.7 and §8.8 collision checks return zero rows.

---

## Schema drift register

| Area | Before Phase 0 | After Phase 0 |
|------|----------------|---------------|
| `db.js` init | Missing `clients`, `cost_codes`, `client_id`; wrong cert shape; auto-created `payment_certificate_lines` | Matches production baseline |
| `jobRoutes.js` | Separate Pool + own `CREATE TABLE jobs` | Uses shared `db.js` pool |
| `paymentRoutes.js` | Used `cert_no`, `period_end` | Uses `certificate_number`, `period_from`, `period_to` |
| Migrations | None | `001_baseline`, `002_tenant_keys` |
| Fresh deploy | Broken (missing tables/columns) | `migrate` + `seed` + `start` |

---

## Doc 22 future gap (not Phase 0)

Doc 22 specifies fully relational PO tables (`purchase_order_lines`, header columns, etc.). **Track A (approved scope) keeps JSON POs until Phase 3A stabilisation is complete.** Do not implement Doc 22 PO rebuild without explicit approval (Path 3B).

Phase 1+ tables not yet created: `users`, `roles`, `user_roles`, `audit_log`, `system_settings`.

---

## Deploy runbook

From `server/`:

```bash
npm run migrate    # apply pending SQL
npm run seed       # default client, cost codes, backfill client_id
npm start          # start API (calls db.init as fallback)
```

Render: run `migrate` and `seed` before or as part of deploy. Set `NODE_ENV=production` and `DATABASE_SSL=true`.

Local: set `DATABASE_SSL=false` (local PostgreSQL does not use SSL by default).

| Variable | Local | Render |
|----------|-------|--------|
| `DATABASE_URL` | `postgresql://…@localhost:5432/…` | Render internal or external URL |
| `DATABASE_SSL` | `false` | `true` |

Netlify: set `VITE_API_URL` to the API URL and redeploy frontend.

---

## Verification SQL (Doc 20 §8)

### Row counts (§8.6)

```sql
SELECT 'clients' AS tbl, COUNT(*) FROM clients
UNION ALL SELECT 'purchase_orders', COUNT(*) FROM purchase_orders
UNION ALL SELECT 'suppliers', COUNT(*) FROM suppliers
UNION ALL SELECT 'cost_codes', COUNT(*) FROM cost_codes
UNION ALL SELECT 'jobs', COUNT(*) FROM jobs
UNION ALL SELECT 'payment_certificates', COUNT(*) FROM payment_certificates
UNION ALL SELECT 'payment_certificate_lines', COUNT(*) FROM payment_certificate_lines;
```

### Collision checks (§8.7 / §8.8) — gate for `002`

```sql
-- 8.7 PO number collisions across clients
SELECT po_number, COUNT(DISTINCT client_id) AS clients
FROM purchase_orders
WHERE client_id IS NOT NULL
GROUP BY po_number
HAVING COUNT(DISTINCT client_id) > 1;

-- 8.8 Supplier ID collisions across clients
SELECT id, COUNT(DISTINCT client_id) AS clients
FROM suppliers
WHERE client_id IS NOT NULL
GROUP BY id
HAVING COUNT(DISTINCT client_id) > 1;
```

### Active client (§8.9)

```sql
SELECT id, code, name, is_active FROM clients WHERE is_active = true;
```

---

## Rollback

Phase 0 has no automatic down migrations. Restore from `pg_dump` backup if migration fails or data is wrong. See `docs/phase0/migration-run-log.md`.
