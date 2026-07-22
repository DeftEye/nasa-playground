# NASA Sky Tracker

A NestJS backend that polls NASA's Astronomy Picture of the Day (APOD) and EONET natural events, persists both in Postgres, and pushes Discord notifications to opt-in subscribers. A Vite + React 19 + Tailwind v4 frontend in `web/` provides the visuals. Multi-user ready via email + password auth (Passport.js + JWT).

## Stack

- **Backend**: NestJS 11 + TypeORM 0.3 + Postgres 17 + Passport.js + JWT + bcrypt
- **Schedulers**: `@nestjs/schedule` (cron + interval)
- **HTTP client**: Node built-in `http`/`https` with typed wrapper (no SDK dep)
- **Frontend**: Vite 8 + React 19 + TS + Tailwind v4 (`@tailwindcss/vite`) + React Router 7 + TanStack Query + axios + MSW 2 + Vitest 4 + RTL 16
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
npm run build         # builds backend (nest build) — run `cd web && npm run build` first for FE
cd web && npm run build  # builds frontend to web/dist/
cd ..
npm run start:prod    # node dist/main — serves both API and FE on port 3000
```

In production, `@nestjs/serve-static` mounts `web/dist` so the built frontend is served at `/` and the API at `/api/*` from a single Node process on port 3000. No CORS headers are emitted (same-origin).

## Environment Variables

See `.env.example` for a template. All keys with defaults are optional.

| Name | Required | Default | Purpose |
|------|----------|---------|---------|
| `POSTGRES_HOST` | yes | `localhost` | Postgres host |
| `POSTGRES_PORT` | yes | `5432` | Postgres port |
| `POSTGRES_USER` | yes | `postgres` | Postgres user |
| `POSTGRES_PASSWORD` | yes | `pass123` | Postgres password |
| `POSTGRES_DB` | yes | `nasa_sky_tracker` | Postgres database |
| `DATABASE_URL` | no | derived from `POSTGRES_*` | Full Postgres URL |
| `NASA_API_KEY` | no | `DEMO_KEY` | NASA API key (falls back to DEMO_KEY) |
| `JWT_SECRET` | yes (prod) | random dev fallback | JWT signing secret |
| `JWT_EXPIRES_IN` | no | `7d` | Token TTL |
| `APOD_CRON` | no | `0 16 * * *` | APOD cron expression (UTC) |
| `EONET_POLL_MINUTES` | no | `15` | EONET poll interval in minutes |
| `EONET_CLOSED_WINDOW_DAYS` | no | `30` | Bounded lookback for closed EONET events |
| `DISCORD_DEFAULT_WEBHOOK_URL` | no | unset | Optional fallback webhook |
| `DISABLE_NOTIFICATION_MOCK` | no | `false` | `true` = real Discord POSTs |
| `AUTH_REQUIRED` | no | `true` | `false` = public NASA reads |
| `PORT` | no | `3000` | NestJS listen port |

## Schedulers

### APOD Scheduler

- **Cron**: `APOD_CRON` (default `0 16 * * *` UTC = 4 PM UTC daily)
- **On-boot catch-up**: if today's APOD row is missing, fetches it. If the DB is empty, backfills the last 30 days.
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
| `POST` | `/api/nasa/triggers/fetch-eonet` | Manual EONET fetch |
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
      pages/                 Home, ApodArchive, EonetFeed, NotificationsLog, Subscribers, Login, Register
      components/            ApodHero, Skeleton, EmptyState, ErrorState, AppLayout, UserMenu
      auth/                  AuthProvider, ProtectedRoute, PublicOnlyRoute
      api/                   axios client + per-domain wrappers
      test/                  MSW server, render helpers, setup
  docker-compose.yml         Postgres 17
  .env.example               Environment variable template
```

## Notes

- **Login rate-limiting**: not implemented in v1; documented as a known gap.
- **EONET closed-window**: closed events are only fetched within `EONET_CLOSED_WINDOW_DAYS` (default 30) to avoid unbounded fetches.
- **Webhook URL privacy**: raw Discord webhook URLs exist only in `subscribers.discord_webhook_url`; all API responses and notification log payloads use the redacted form `/webhooks/.../<last-4>`.
- **JWT secret rotation**: change `JWT_SECRET` and restart; all previously-issued tokens become invalid.
