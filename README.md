# NASA Sky Tracker

A NestJS backend that polls NASA's Astronomy Picture of the Day (APOD) and EONET natural events, persists both in Postgres, and pushes Discord notifications to opt-in subscribers. A Vite + React 19 + Tailwind v4 frontend in `web/` provides the visuals, including an interactive 3D globe that plots recent EONET events. Multi-user ready via email + password auth (Passport.js + JWT).

## Stack

- **Backend**: NestJS 11 + TypeORM 0.3 + Postgres 17 + Passport.js + JWT + bcrypt
- **Schedulers**: `@nestjs/schedule` (cron + interval)
- **HTTP client**: Node built-in `http`/`https` with typed wrapper (no SDK dep)
- **Frontend**: Vite 8 + React 19 + TS + Tailwind v4 (`@tailwindcss/vite`) + React Router 7 + TanStack Query + axios + MSW 2 + Vitest 4 + RTL 16 + react-globe.gl (three.js) + `@turf/boolean-point-in-polygon`
- **Monorepo**: single `package.json` at repo root; Vite workspace in `web/`

## Quick Start

### Prerequisites

- Node 24+, npm 11+
- Docker (Orbstack or Docker Desktop) for Postgres

### 1. Start Postgres

```bash
docker compose up -d db
# Verify:
PGPASSWORD=pass123 psql -h localhost -U postgres -d nasa_sky_tracker -c "SELECT 1"
```

### 2. Install dependencies

```bash
npm install          # root (backend)
cd web && npm install # frontend
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET (required), NASA_API_KEY (optional, defaults to DEMO_KEY)
```

### 4. Development mode

```bash
npm run dev
```

This runs NestJS (port 3000) and Vite (port 5173) concurrently via `concurrently`. The Vite dev server proxies `/api/*` to NestJS.

- Frontend: http://localhost:5173
- API: http://localhost:3000/api/*
- Health: http://localhost:3000/api/nasa/health

### 5. Production mode

```bash
cd web && npm run build    # builds frontend to web/dist/
cd ..
npm run build              # builds backend (nest build)
npm run migration:run      # apply migrations (or npm run migration:run:prod from compiled dist/)
npm run start:prod         # node dist/main — serves both API and FE on port 3000
```

In production, `synchronize` is disabled and the schema must be applied via migrations. On a fresh database, `npm run start:prod` will fail to boot if migrations have not run. `@nestjs/serve-static` mounts `web/dist` so the built frontend is served at `/` and the API at `/api/*` from a single Node process on port 3000. No CORS headers are emitted (same-origin).

**SPA deep-link fallback:** the production stack serves the SPA shell for any non-`/api/*` GET that does not resolve to a static asset. Hard-navigating or refreshing a client-side route (for example `/apod/archive`, `/globe`, `/login`) returns the SPA `index.html` (200 `text/html`) so React Router renders the right page instead of a JSON 404. Unknown `/api/*` routes still return the standard Nest JSON 404.

## Environment Variables

See `.env.example` for a template. All keys with defaults are optional.

| Name | Required | Default | Purpose |
|------|----------|---------|---------|
| `NODE_ENV` | no | `development` | `production` disables auto-sync and enforces fail-fast env validation |
| `POSTGRES_HOST` | yes | `localhost` | Postgres host |
| `POSTGRES_PORT` | yes | `5432` | Postgres port |
| `POSTGRES_USER` | yes | `postgres` | Postgres user |
| `POSTGRES_PASSWORD` | yes | `pass123` | Postgres password |
| `POSTGRES_DB` | yes | `nasa_sky_tracker` | Postgres database |
| `NASA_API_KEY` | no | `DEMO_KEY` | NASA API key (falls back to DEMO_KEY) |
| `JWT_SECRET` | yes (prod) | random dev fallback | JWT signing secret; production startup validation refuses to boot if missing/invalid |
| `JWT_EXPIRES_IN` | no | `7d` | Token TTL |
| `APOD_CRON` | no | `0 16 * * *` | APOD cron expression (UTC) |
| `EONET_POLL_MINUTES` | no | `15` | EONET poll interval in minutes |
| `EONET_CLOSED_WINDOW_DAYS` | no | `30` | Bounded lookback for closed EONET events |
| `DISABLE_NOTIFICATION_MOCK` | no | `false` | `true` = real Discord POSTs |
| `AUTH_REQUIRED` | no | `true` | `false` = public NASA reads |
| `PORT` | no | `3000` | NestJS listen port |

## Schedulers

### APOD Scheduler

- **Cron**: `APOD_CRON` (default `0 16 * * *` UTC = 4 PM UTC daily)
- **On-boot catch-up**: if today's APOD row is missing, fetches it. If the DB is empty, backfills the last 30 days.
- **Manual backfill (already-populated DBs)**: the automatic 30-day backfill only runs on an empty table at boot, so for production databases that are already running with existing history, use the JWT-guarded `POST /api/nasa/triggers/backfill-apod` and `POST /api/nasa/triggers/backfill-eonet` endpoints (the APOD Archive page also exposes a "Backfill 30 days" button that calls these).
- **Retry**: 3 total attempts (1 initial + 2 retries) with exponential backoff (1s, 3s). A 9s slot is reserved for a potential future 4th attempt.
- **DEMO_KEY fallback**: if `NASA_API_KEY` is unset, uses `DEMO_KEY` with a warning log.
- **Timeout**: 15s per NASA APOD request.
- **Skip-if-running**: a concurrent tick is skipped if the previous one is still in flight.

### EONET Scheduler

- **Interval**: `EONET_POLL_MINUTES` (default 15 min) via `setInterval`
- **Categories**: seeds `eonet_categories` on first run if empty
- **Closed events**: fetched within a bounded window (`EONET_CLOSED_WINDOW_DAYS`, default 30 days) — never unbounded
- **Retry**: same 3-attempt backoff as APOD (1s, 3s, 9s reserved)
- **Timeout**: 30s per NASA EONET request (EONET can be slow, ~45s observed)
- **Skip-if-running**: concurrent ticks are skipped and logged
- **Malformed geometry**: events with non-array geometry are skipped entirely; other events in the same payload persist normally
- **Large geometry**: 1000+ point geometries are preserved verbatim in `jsonb`

### Notification Fan-Out

- After a successful APOD fetch or EONET diff, `NotificationService.fanOut` iterates matching subscribers and writes one `notification_log` row per subscriber.
- **Mock mode** (default): no real Discord POST; log row status = `mocked`.
- **Real mode** (`DISABLE_NOTIFICATION_MOCK=true`): POSTs to each subscriber's Discord webhook; status = `sent` (2xx) or `failed` (non-2xx/error).
- **No transport retry**: exactly one POST per subscriber per fan-out.
- **Zero subscribers**: no sentinel/placeholder rows; trigger still returns 2xx.
- **Webhook URL privacy**: webhook URLs are redacted to `/webhooks/.../<last-4>` in all logs and API responses.

## Subscriber Management

Subscribers are Discord notification targets owned by a user. Each subscriber has:

- **Name**: display label
- **Discord webhook URL**: stored as a secret, never echoed in API responses
- **`apodEnabled`**: receives APOD notifications when true
- **`eonetCategorySlugs`**: empty = all EONET events; non-empty = only matching categories
- **`enabled`**: master toggle; when false, no notifications are sent (except test-notification which ignores this flag)

### API Endpoints (all JWT-guarded, scoped to `req.user.id`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Register new user |
| `POST` | `/api/auth/login` | Login, returns JWT |
| `GET` | `/api/auth/me` | Current user |
| `DELETE` | `/api/auth/me` | Self-delete (cascades to subscribers + logs) |
| `POST` | `/api/subscribers` | Create subscriber |
| `GET` | `/api/subscribers` | List own subscribers (no webhook URL) |
| `PATCH` | `/api/subscribers/:id` | Update subscriber |
| `DELETE` | `/api/subscribers/:id` | Delete subscriber |
| `POST` | `/api/subscribers/:id/test-notification` | Send test (ignores `enabled`) |
| `GET` | `/api/notifications` | List own notification logs |
| `GET` | `/api/nasa/apod/today` | Today's APOD |
| `GET` | `/api/nasa/apod` | APOD archive (paginated) |
| `POST` | `/api/nasa/triggers/fetch-apod` | Manual APOD fetch |
| `GET` | `/api/nasa/eonet/categories` | EONET categories |
| `GET` | `/api/nasa/eonet/events` | EONET events (filtered) |
| `GET` | `/api/nasa/eonet/events/map` | Map-ready EONET events (one normalized `{lat, lng}` per event; rolling 7/14/30-day window; optional `category`/`status` filters) for the globe view |
| `POST` | `/api/nasa/triggers/fetch-eonet` | Manual EONET fetch |
| `POST` | `/api/nasa/triggers/backfill-apod?days=30` | Backfill up to `days` (int 1–30, default 30) days of APOD entries; idempotent; per-date fault-tolerant — a single unavailable date is recorded in `failed` rather than aborting the loop or returning 500; returns 200 with a partial-success summary `{ requestedDays, saved, failed }`; 400 on invalid `days` |
| `POST` | `/api/nasa/triggers/backfill-eonet` | Re-ingest the recent EONET window (open + closed-within-window) idempotently; returns 200 with a `{detected, updated, skipped, unchanged}` diff summary |
| `GET` | `/api/nasa/health` | Health check (DB + NASA reachability) |

### Multi-User Isolation

Each subscriber belongs to the user who created it. Subscribers, notification logs, and category selections are never visible across users. Cross-user PATCH/DELETE returns 404.

### GDPR-Friendly Delete

`DELETE /api/auth/me` removes the user and cascades via Postgres `ON DELETE CASCADE` foreign keys to delete all of the user's subscribers, subscriber_categories, and notification_log rows.

## Testing

```bash
# Backend (Jest + supertest + nock)
npm test                                    # all tests
npm test -- --testPathPattern auth          # scoped
npm test -- --testPathPattern cross-flow    # E2E cross-flow tests

# Frontend (Vitest + RTL + MSW)
cd web && npm run test -- --run             # all tests
cd web && npm run test -- --run Home        # scoped

# Type checking
npm run typecheck                           # root (backend only; web/ excluded)
cd web && npm run typecheck                 # frontend

# Linting
npm run lint                                # root
cd web && npm run lint                      # frontend
```

### Test Database

Backend integration tests use a separate database `nasa_sky_tracker_test`. It is created automatically by `init.sh` or `services.yaml`'s `test_db` service. Jest runs with `maxWorkers: 1` (serial) because the test DB is shared across suites.

## Database Migrations

TypeORM schema synchronization is environment-conditional: `synchronize: true` in development and test, and `synchronize: false` in production (`NODE_ENV=production`). In production, the database schema must be applied via committed migrations, not auto-sync.

A standalone `src/data-source.ts` TypeORM DataSource (with `synchronize: false`) drives the CLI. The initial migration is `src/migrations/1784792437520-InitialSchema.ts`; it begins with `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` and then creates all 8 tables with foreign keys, `ON DELETE CASCADE`, and indexes.

Available npm scripts:

```bash
npm run migration:generate -- src/migrations/NameOfMigration  # generate a new migration from entity changes (dev only)
npm run migration:run                                         # apply pending migrations against src/data-source.ts (dev/test)
npm run migration:revert                                      # roll back the last applied migration (dev/test)
npm run migration:run:prod                                    # run the compiled migration runner, node dist/migration-runner.js (no ts-node)
```

Generating a new migration after changing an entity:

1. Make the entity change in `src/`.
2. Ensure the dev database is running and up to date.
3. Run `npm run migration:generate -- src/migrations/ShortDescription`.
4. Review the generated file and commit it.

Production flow (local or container):

```bash
cd web && npm run build    # build frontend to web/dist/
cd ..
npm run build              # build backend to dist/
npm run migration:run:prod # apply compiled migrations (no ts-node)
npm run start:prod         # start the server
```

Inside the Docker container, migrations run automatically via `docker-entrypoint.sh` before the main process starts.

## Continuous Integration

GitHub Actions workflow at `.github/workflows/ci.yml` runs on every `push` and `pull_request` to `master`. The single `ci` job mirrors the local commands in `services.yaml`:

1. `npm ci` (root) + `npm ci` (web)
2. `npm run typecheck` (root + web)
3. `npm run lint:check` (root + web) — non-mutating lint (no `--fix` in CI)
4. `npm run build` (backend → `dist/`) — runs before tests because `prod-shutdown.spec.ts` spawns the compiled `dist/main`
5. `npm test` (backend, against a `postgres:17` service container; `maxWorkers:1`; `NODE_ENV=test`; non-secret `POSTGRES_*/JWT_SECRET`)
6. `cd web && npm run test -- --run` (frontend Vitest)
7. `cd web && npm run build` (frontend → `web/dist/`)
8. `docker build -t nasa-sky-tracker:ci .`

No real secrets are referenced — `JWT_SECRET` and `POSTGRES_*` use non-secret throwaway values (the Postgres password is `pass123`, matching the value `prod-shutdown.spec.ts` hardcodes). The backend-test step has a single automatic retry to absorb a known intermittent auth test flake.

Check run status:

```bash
gh run list                       # recent runs
gh run view <run-id>              # step-by-step status
gh run watch <run-id> --exit-status   # block until conclusion
```

## Deployment (Docker)

The repository ships a multi-stage `Dockerfile` based on `node:24-slim` and a `docker-compose.prod.yml` stack (top-level project name: `nasa-sky-tracker-prod`). The build stage compiles the backend (`dist/`) and frontend (`web/dist/`), rebuilds `bcrypt` against the slim runtime, and the final image ships production-only `node_modules` plus the compiled artifacts and `docker-entrypoint.sh`.

On startup the container runs `node dist/migration-runner.js` and then `node dist/main`, so migrations are applied automatically before the server binds port 3000. The same process serves the API at `/api/*` and the built SPA at `/`.

Build and run the production stack locally:

```bash
# Option A: build the image directly
docker build -t nasa-sky-tracker:latest .

# Option B: recommended — build and start the full compose stack
docker compose -f docker-compose.prod.yml up -d --build
```

Set secrets via environment variables or a compose env file (for example, create a `.env.prod` and pass `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build`). **Never commit real secrets to the repository.** The compose file sets non-secret defaults for `JWT_SECRET` and `NASA_API_KEY` that are only suitable for local smoke testing; override them for real deployments.

Verify the stack is healthy:

```bash
curl http://localhost:3000/api/nasa/health
```

Tear down the stack and remove the named volume:

```bash
docker compose -f docker-compose.prod.yml down -v
```

> **Port conflict warning:** The production `app` service binds host port `3000`. Do not run it at the same time as the local dev `api` service (or `npm run dev` / `npm run start:prod` on the host), or the ports will collide.

## Project Structure

```
/
  src/                       NestJS backend
    auth/                    JWT auth (register, login, /me, DELETE /me)
    users/                   User entity
    nasa/
      apod/                  APOD entity, service, scheduler, controller
      eonet/                 EONET entities, service, scheduler, controller
      common/                NasaClientService (typed HTTP wrapper)
      health/                Health check endpoint
    subscribers/             Subscriber CRUD + test-notification
    notifications/           Notification log, fan-out, Discord transport
  web/                       Vite + React + TS + Tailwind frontend
    src/
      pages/                 Home, ApodArchive, EonetFeed, EonetGlobe, NotificationsLog, Subscribers, Login, Register
      components/            ApodHero, Skeleton, EmptyState, ErrorState, AppLayout, UserMenu
      components/globe/      GlobeView (react-globe.gl), GlobeFilterBar, GlobeErrorBoundary, WebGL guard
      auth/                  AuthProvider, ProtectedRoute, PublicOnlyRoute
      api/                   axios client + per-domain wrappers
      test/                  MSW server, render helpers, setup
    public/
      countries.geojson      Natural Earth 110m countries (bundled; client-side country resolution via @turf)
  docker-compose.yml         Postgres 17
  .env.example               Environment variable template
```

## Notes

- **Production env validation**: on startup, the app validates required environment variables. In `NODE_ENV=production`, a missing or invalid required variable (for example `JWT_SECRET`) is logged by name and the process exits non-zero before binding the port.
- **Security headers**: `helmet` is applied globally in all environments.
- **Content-Security-Policy**: the helmet CSP allows external APOD images (`apod.nasa.gov`) and YouTube/Vimeo video embeds so the archive/media pages render correctly; other helmet protections remain in effect.
- **Graceful shutdown**: NestJS `enableShutdownHooks()` plus a `SIGTERM` handler close the database connection and exit with code `0`.
- **Node version**: Node 24 is pinned via `.nvmrc` and `package.json` `engines`.
- **Login rate-limiting**: not implemented in v1; documented as a known gap.
- **EONET closed-window**: closed events are only fetched within `EONET_CLOSED_WINDOW_DAYS` (default 30) to avoid unbounded fetches.
- **Webhook URL privacy**: raw Discord webhook URLs exist only in `subscribers.discord_webhook_url`; all API responses and notification log payloads use the redacted form `/webhooks/.../<last-4>`.
- **JWT secret rotation**: change `JWT_SECRET` and restart; all previously-issued tokens become invalid.
- **NASA upstream error mapping**: NASA's typed client errors (non-`HttpException` `Error` subclasses) are mapped by a global exception filter to meaningful HTTP responses — `NasaApiUnavailableError` → `503 Service Unavailable`, `NasaApiRateLimitError` → `429 Too Many Requests` (JSON body matching Nest's standard `{ statusCode, message, error }` shape). NASA-backed endpoints no longer surface a raw generic 500.
