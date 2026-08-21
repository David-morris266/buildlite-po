# BuildLite (dmcc-cvr-system)

Purchase order platform — React (Vite) frontend + Express/Postgres API.

**Current position:** branch `buildlite-V1-1`, Doc 67 persistence programme. Developments, packages, Commercial Events, order matrices, V1 payment certificates, CVR periods and purchase ledger are server-authoritative when their local authority flags are ON. **BL-030 is fully complete** (historical-freeze UAT passed). **BL-031E is COMPLETE** (Test Site 1 snapshot creation and historic freeze UAT **PASSED**). **BL-031F is COMPLETE** (P02 monthly-cycle UAT **PASSED**). **BL-032A is COMPLETE** (development revenue strategy/settings persist to Postgres when `VITE_REVENUE_SERVER_AUTHORITY=true`; Test Site 1 authority-on UAT **PASSED**; default OFF). **BL-032B is COMPLETE** (private plot Secured Revenue lifecycle; same-price and differing-price Plot 31 UATs **PASSED**; Selling Price HTML `step` corrected to `0.01`). **BL-032C is COMPLETE** (live Draft/Submitted CVR Revenue + Gross Profit; Test Site 1 P03 Draft UAT **PASSED**). **BL-032D is COMPLETE** (schema-v2 whole-CVR Revenue snapshot; Test Site 1 P03 lock/freeze UAT **PASSED**; migration `012` applied to local `buildlite_clone`). **BL-033A design is ACCEPTED.** **BL-033B is COMPLETE** (tenant cost-code semantic classification; Test Site 1 `5231` Cleaning → PRELIMS + STANDARD_CVR; CVR money unchanged; migration `013` applied to local `buildlite_clone`). **BL-033C is COMPLETE** (typed `development_programme`; Test Site 1 programme UAT **PASSED**; migration `014` applied to local `buildlite_clone`). **BL-033C.1 is COMPLETE** (explicit YYYY-MM picker; Test Site 1 reporting-month UAT **PASSED**; P04 Draft `reporting_month` **2026-08**; P01–P03 remain NULL). P03 is **locked** with snapshot `0ad18cb8-0b1a-469a-8fa0-10216728150a`. P04 is **Draft** `0f513191-cd25-4812-834f-37dcf66487e0` v1 with no snapshot. Repo CVR/ledger/revenue flag defaults remain OFF. See `CURRENT_STATE.md` and `docs/test-data/README.md`.

Server automated tests must use isolated `TEST_DATABASE_URL` / `buildlite_test` (`npm run test:ensure-db` from `server/`). Do not run them against `buildlite_clone`.

**Phase 0** (migrations, seed, schema alignment) remains in the codebase as a historic baseline. Deploy to staging/production still requires commercial pre-flight (backup + verification) before running migrations.

---

## Repository layout

| Path | Purpose |
|------|---------|
| `client/` | Vite/React frontend (Netlify) |
| `server/` | Express API (Render) |
| `server/migrations/` | Versioned SQL migrations |
| `server/scripts/` | `migrate.js`, `seed.js` |
| `docs/DATABASE.md` | Schema reference and runbook |

---

## Local development

### Server

```bash
cd server
cp .env.example .env          # set DATABASE_URL
npm install
npm run migrate
npm run seed
npm run dev                     # http://localhost:3001
```

### Client

```bash
cd client
cp .env.example .env.local      # VITE_API_URL=http://localhost:3001
npm install
npm run dev
```

---

## Render deploy (API)

1. Ensure `DATABASE_URL` is linked to Postgres.
2. Set `NODE_ENV=production`.
3. **Before or during deploy**, run:
   ```bash
   npm run migrate
   npm run seed
   ```
4. Start command: `npm start`

Health check: `GET /health` — returns `503` if DB unreachable, required tables missing, or migrations pending.

---

## Netlify deploy (frontend)

Set environment variable:

```
VITE_API_URL=https://buildlite-po-api.onrender.com
```

Redeploy after changing `client/src/api.js` or env vars.

---

## Phase 0 scope

- Migration framework + baseline schema alignment
- Single DB pool (jobs routes consolidated)
- DB-aware `/health`
- Debug routes gated in production
- `VITE_API_URL` configuration

**Not included:** authentication (Phase 1), admin UI (Phase 2), PO redesign (Phase 3B).

See `docs/DATABASE.md` and `docs/phase0/migration-run-log.md` for migration evidence and rollback.

---

## Production targets

- Database: `buildlite_po_db` (Render Postgres)
- API: `https://buildlite-po-api.onrender.com`
- Frontend: Netlify
