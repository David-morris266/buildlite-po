# BuildLite (dmcc-cvr-system)

Purchase order platform — React (Vite) frontend + Express/Postgres API.

**Current position:** branch `buildlite-V1-1`, Doc 67 persistence programme. Developments, packages and Commercial Events are server-authoritative. **NEXT is BL-029 Order Matrix Persistence.** See `CURRENT_STATE.md` and `docs/test-data/README.md`.

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
