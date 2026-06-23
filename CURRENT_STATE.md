# BuildLite Current State Assessment

## Purpose

This document records the actual status of the BuildLite platform after Phase 0 implementation (code ready for review; staging/production deploy pending commercial sign-off).

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

---

## Module status

| Module | Status | Notes |
|--------|--------|-------|
| Purchase Orders | Working | JSON in `purchase_orders.payload`; full UI (Form, List, Archive) |
| Suppliers | Working | JSON payload; client-scoped |
| Cost Codes | Working | DB table + seed from `server/data/cost_codes.json` |
| Jobs | Working | Shared DB pool; `jobs` table via migrations |
| Clients / Brand | Working | Active client resolution; brand profiles |
| User Login | Mock only | `localStorage` identity — **Phase 1** |
| Payment Certificates | Backend only | Routes aligned to production columns; no UI |
| Variations | Not built | Planned |
| CVR Dashboard | Not built | Planned |
| Administration | Partial | No master-data admin UI — **Phase 2** |

---

## Database (Phase 0)

| Item | Status |
|------|--------|
| Migration framework | `server/migrations/`, `npm run migrate` |
| Baseline migration | `001_baseline.sql` |
| Tenant keys migration | `002_tenant_keys.sql` (conditional — collision gate) |
| Seed script | `npm run seed` — default client, cost codes, `client_id` backfill |
| `db.js` init | Aligned with Doc 20 production baseline |
| Single connection pool | `jobRoutes.js` uses `../db` |
| Schema reference | `docs/DATABASE.md` |

Production has 8 tables including legacy `payment_certificate_lines`. Fresh deploy does not auto-create `payment_certificate_lines`.

---

## API (Phase 0 changes)

| Endpoint / area | Change |
|-----------------|--------|
| `GET /health` | DB ping, required tables, pending migrations |
| `GET /api/po/_debug` | 404 when `NODE_ENV=production` |
| `GET /api/payments/_debug` | 404 when `NODE_ENV=production` |
| Payment certificate routes | Columns: `certificate_number`, `period_from`, `period_to` |

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
| Global `po_number` PK (until `002` applied) | Phase 0 conditional |
| `server/routes/supplierRoutes.js` orphan | Later cleanup |

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

- `docs/DATABASE.md` — schema, indexes, verification SQL, rollback
- `docs/phase0/migration-run-log.md` — deploy evidence template
- `server/migrations/README.md` — migration ordering
