# AGENTS.md

## Cursor Cloud specific instructions

NASA Sky Tracker is a single product: a NestJS 11 backend (`src/`, root `package.json`)
plus a Vite + React 19 frontend (`web/`). In dev they run as two servers; in prod one
Node process serves both. Standard commands live in `README.md` and `TESTING.md` — read
those rather than duplicating them here. The notes below are the non-obvious,
Cloud-VM-specific gotchas.

### Node version (important)
- The project requires Node 24 (`.nvmrc`, `engines >=24`). The VM's default `node` on
  `PATH` (`/exec-daemon/node`) is Node 22 and would otherwise win. Setup appended a block
  to `~/.bashrc` that runs `nvm use 24` and prepends nvm's Node 24 bin to `PATH`.
- Therefore run all `npm`/`node` commands in a **login shell** so Node 24 is active
  (e.g. `bash -lc '...'`). Verify with `node -v` → `v24.x`. A non-login shell may pick up
  Node 22.

### Postgres (must be started manually each VM boot)
- Postgres 17 (PGDG) is installed locally; the app connects over TCP as
  `postgres` / `pass123`. Databases `nasa_sky_tracker` (dev) and `nasa_sky_tracker_test`
  (backend tests) already exist. Docker is NOT installed, so ignore the `docker compose up -d db`
  instruction in the README — the local cluster replaces it.
- The cluster does not auto-start on a fresh VM. Start it before running the app or backend
  tests: `sudo pg_ctlcluster 17 main start` (check with `pg_lsclusters`).
- The dev `.env` is gitignored; setup created one with `POSTGRES_PASSWORD=pass123`,
  a dev `JWT_SECRET`, and `AUTH_REQUIRED=false`. Recreate it from `.env.example` if missing.

### Running / testing
- Dev: `npm run dev` (login shell) runs NestJS on :3000 and Vite on :5173 (Vite proxies
  `/api`). Health: `curl http://localhost:3000/api/nasa/health` → `{"status":"ok","db":"up",...}`.
- On boot the schedulers do a real catch-up fetch against NASA's live APOD/EONET APIs
  (using `DEMO_KEY`), so the dev DB is populated with real data and the log is initially
  noisy with `EONET event detected` lines — this is expected, not an error.
- Backend tests (`NODE_ENV=test npm test`) need Postgres running and, because
  `prod-shutdown.spec.ts` spawns the compiled `dist/main`, a prior `npm run build`.
  Tests run serially (`maxWorkers:1`) against `nasa_sky_tracker_test`; NASA calls are mocked.
- `snowflake-sdk` and `src/customers/` are leftover template scaffolding — not part of the
  product and require no external services.
