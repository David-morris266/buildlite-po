# BuildLite database migrations

Phase 0 introduces versioned SQL migrations. **Do not edit a migration file after it has been applied to production.**

## Order

| File | Purpose |
|------|---------|
| `001_baseline.sql` | Phase 0 additive baseline (frozen) |
| `002_tenant_keys.sql` | Tenant-scoped unique indexes + `jobs.client_id` — **run only after collision checks** (frozen) |
| `003_reconcile_production.sql` | BL-006: align schema with Render production (additive only) |
| `004_developments.sql` | BL-027A: developments (Doc 67) |
| `005_packages.sql` | BL-027B: packages + package_purchase_orders (Doc 67) |
| `006_commercial_events.sql` | BL-028A: commercial_events + commercial_event_audit (Doc 67) |
| `007_package_order_matrices.sql` | BL-029A: package_order_matrices schema/API only (client still localStorage) |

## Before applying to production

1. Take a `pg_dump` backup.
2. Run Doc 20 §8 verification SQL and save results.
3. Apply on **staging** first.
4. For `002_tenant_keys.sql`: confirm queries 8.7 and 8.8 return **zero rows** before applying.
5. Apply `003_reconcile_production.sql` after `001` and `002` (or after `001` if `002` was deferred).

## Commands

From `server/`:

```bash
npm run migrate
npm run seed
```

## Tracking

Applied files are recorded in `schema_migrations`.

## Rollback

There are no automatic down migrations. Restore from backup if needed (see `docs/phase0/migration-run-log.md`).
