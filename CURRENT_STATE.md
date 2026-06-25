# BuildLite Current State Assessment

## Purpose

This document records the actual status of the BuildLite platform after Phase 0 implementation and **BL-006 Production Schema Reconciliation** (code ready for review; production deploy pending commercial sign-off).

---

## Repository

| Item | Value |
|------|-------|
| Branch | `buildlite-V1-1` |
| Repository | `buildlite-po` / `dmcc-cvr-system` |

---

## Release track (approved)

Phases 0 → 1 → 2 → 3A (Track A — JSON purchase orders retained).

**Phase 0:** Implemented in codebase — **not yet deployed to production** until backup + verification (P0-0) and staging tests pass.

**BL-006:** Production schema reconciliation complete in codebase — validated locally against `buildlite_local` and production clone (`buildlite_clone`).

---

## Module status

| Module | Status | Notes |
|--------|--------|-------|
| Purchase Orders | Working | JSON in `purchase_orders.payload`; full UI (Form, List, Archive) |
| Suppliers | Working | JSON payload; client-scoped |
| Cost Codes | Working | DB table + seed from `server/data/cost_codes.json` |
| Jobs | Working | Shared DB pool; client-scoped via `jobs.client_id` |
| Clients / Brand | Working | Active client resolution; flat-column brand profiles |
| User Login | Mock only | `localStorage` identity — **Phase 1 (out of scope for BL-006)** |
| Payment Certificates | Backend only | Routes use `legacy_cert_no`; no UI |
| Variations | Not built | Planned |
| CVR Dashboard | Not built | Planned |
| Administration | Partial | No master-data admin UI — **Phase 2** |

---

## Database

| Item | Status |
|------|--------|
| Migration framework | `server/migrations/`, `npm run migrate` |
| Baseline migration | `001_baseline.sql` (frozen) |
| Tenant keys migration | `002_tenant_keys.sql` (frozen) |
| Reconciliation migration | `003_reconcile_production.sql` (BL-006) |
| Seed script | `npm run seed` — default client, brand profile row, cost codes, `client_id` backfill |
| `db.js` init | Aligned with Render production schema (post-003) |
| Single connection pool | `jobRoutes.js` uses `../db` |
| Schema reference | `docs/DATABASE.md` |

Production has 8 tables including legacy `payment_certificate_lines`. Fresh deploy does not auto-create `payment_certificate_lines`.

**BL-006 changes:** Codebase now matches production for `client_brand_profiles` (flat columns), `payment_certificates` (`legacy_cert_no`), seed compatibility, and job tenant scoping.

---

## API (Phase 0 + BL-006)

| Endpoint / area | Change |
|-----------------|--------|
| `GET /health` | DB ping, required tables, pending migrations |
| `GET /api/po/_debug` | 404 when `NODE_ENV=production` |
| `GET /api/payments/_debug` | 404 when `NODE_ENV=production` |
| Payment certificate routes | Read/write `legacy_cert_no`; API aliases preserved |
| Job routes | Scoped to active `client_id`; new jobs set `client_id` |

No new business endpoints. No authentication middleware.

---

## Frontend (Phase 0)

| Change | Detail |
|--------|--------|
| `client/src/api.js` | Uses `VITE_API_URL` (fallback `http://localhost:3001`) |

PO UI unchanged. Role toggle and mock login unchanged.

---

## Technical debt (remaining)

| Item | Phase |
|------|-------|
| Real authentication | Phase 1 |
| RBAC; remove role toggle | Phase 3A |
| Master-data admin CRUD | Phase 2 |
| Unauthenticated DELETE/approve on POs | Phase 1+ |
| Global `po_number` PK (composite unique in `002`) | Monitor at multi-tenant |
| `server/routes/supplierRoutes.js` orphan | Later cleanup |
| PDF brand still hardcoded in `pdf.js` | Future — DB brand profile unused in PDFs |

---

## Repo hygiene (Phase 0)

Removed: `Replacement filed/` (obsolete PO backup).

---

## Next actions (before production deploy)

1. Commercial manager: backup + Doc 20 §8 verification (P0-0).
2. Developer: apply migrations + seed on **staging**; run test plan (T8–T27).
3. Record results in `docs/phase0/migration-run-log.md`.
4. Production deploy after staging sign-off (T28–T31).
5. **Phase 1** starts only after Phase 0 commercial sign-off.

---

## Documentation

- `docs/DATABASE.md` — production schema, indexes, verification SQL, rollback
- `docs/phase0/migration-run-log.md` — deploy evidence template
- `server/migrations/README.md` — migration ordering
