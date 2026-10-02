# BuildLite hosted pilot runbook

This runbook covers a new, clean pilot environment. It contains no credentials or customer data.

## Frontend — Netlify

Build `client` with `npm run build` and publish `client/dist`. The tracked `_redirects` file provides SPA fallback for BuildLite, `/sign-in/...` and `/sign-up/...` direct navigation.

Required environment variable names:

- `VITE_API_URL`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_CE_SERVER_AUTHORITY=true`
- `VITE_MATRIX_SERVER_AUTHORITY=true`
- `VITE_CERTIFICATE_SERVER_AUTHORITY=true`
- `VITE_CVR_SERVER_AUTHORITY=true`
- `VITE_LEDGER_SERVER_AUTHORITY=true`
- `VITE_REVENUE_SERVER_AUTHORITY=true`
- `VITE_COST_CODE_SERVER_AUTHORITY=true`

`VITE_API_BASE_URL` is legacy and is not consumed by the current client. Never put a server secret in a `VITE_*` variable.

## Backend — Render

Required production variable names:

- `NODE_ENV=production`
- `DATABASE_URL`
- `DATABASE_SSL` (`true` or `false`; hosted Render PostgreSQL normally uses `true`)
- `CORS_ALLOWED_ORIGINS` (explicit comma-separated HTTPS origins; no wildcard)
- `CLERK_SECRET_KEY`
- `BUILDLITE_APP_URL` (canonical HTTPS frontend origin)

`BUILDLITE_PLATFORM_OPERATOR_IDS` is optional for server availability. When absent, assisted tenant provisioning is disabled because nobody receives `platform.tenant_provision`. Configure only reviewed Clerk provider user IDs when provisioning is required.

Feature-specific email variables are `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL` and `APPROVER_EMAILS`. `COST_CODE_IMPORT_REVIEW_SECRET` may be configured as a dedicated review secret.

Production must never set `BUILDLITE_SERVER_TEST`, `TEST_DATABASE_URL`, or relax service authorization through `BUILDLITE_STRICT_SERVICE_AUTH=0`.

## New pilot database bootstrap

1. Positively identify the target database with `SELECT current_database()` and verify its host without printing credentials.
2. If it is not empty, stop and take a verified backup first.
3. From the matching release under `server`, run `npm.cmd run migrate`.
4. Verify every repository migration is recorded exactly once and the frontier matches the latest ordered SQL migration.
5. **Do not run `npm run seed`.** It is the legacy generic-client/Cost Code bootstrap and is not the modern tenant provisioning path.
6. Start the API with validated production configuration.
7. Verify public `GET /health` returns HTTP 200 and `status: ready`.
8. Configure a reviewed platform operator provider ID when assisted provisioning is required.
9. Provision the first company through the supported Administration workflow.
10. Invite users through normal membership administration.

Before real customer data, prove a logical backup can be restored into a disposable database and verify the migration frontier, representative row counts and authenticated read-only application access.
