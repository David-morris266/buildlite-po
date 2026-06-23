# BuildLite database migrations

Phase 0 introduces versioned SQL migrations. **Do not edit a migration file after it has been applied to production.**

## Order

| File | Purpose |
|------|---------|
| `001_baseline.sql` | Additive schema alignment with production (Doc 20 Appendix A) |
| `002_tenant_keys.sql` | Tenant-scoped unique indexes + `jobs.client_id` — **run only after collision checks** |

## Before applying to production

1. Take a `pg_dump` backup.
2. Run Doc 20 §8 verification SQL and save results.
3. Apply on **staging** first.
4. For `002_tenant_keys.sql`: confirm queries 8.7 and 8.8 return **zero rows** before applying.

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
