# Testing Guide

This project ships with three test layers, each with a clear responsibility:

1. **Backend integration & unit tests** — Jest 30 + supertest + nock, hitting the real `nasa_sky_tracker_test` Postgres DB.
2. **Frontend component & page tests** — Vitest 4 + @testing-library/react + MSW 2 (jsdom).
3. **Live end-to-end black-box tests** — `curl`, `psql`, and `agent-browser` against the running stack (NestJS on `:3000`, Vite on `:5173`).

The `services.yaml` gate command (`npm test`) runs everything scoped to that surface in one shot: it executes `npm test` for the root backend and `cd web && npm run test -- --run` for the frontend.

---

## 1. Quickstart

```bash
# one-time
npm run dev                   # installs both root and web, brings up Postgres on :5432, creates DBs
                             # dev server: concurrently runs NestJS on :3000 and Vite on :5173

# run the full test suite
npm test                      # backend: 16 suites / 112 tests, ~22s
cd web && npm run test --run  # frontend: 9 files / 84 tests, ~3s
```

Prereqs:

- Orbstack (Docker daemon) up — `docker info` should be 0; if not, `open -a Orbstack` then retry.
- Postgres reachable on `:5432` — `services.yaml` provides a `db` and `test_db` service that handles bring-up + DB creation idempotently.

---

## 2. Backend tests (Jest + supertest + nock)

### 2.1 Where specs live

Backend specs sit next to their source: `src/<module>/<thing>.spec.ts`. Examples:

- `src/auth/auth.integration.spec.ts` — POST/GET/DELETE /api/auth/* happy + reject paths against the real test DB with a fresh HTTP app per spec.
- `src/nasa/apod/apod.integration.spec.ts` — fetch + persist + pagination + YouTube embed transform.
- `src/nasa/apod/apod.scheduler.spec.ts` — `@Cron` invocations exercised directly without booting Nest.
- `src/notifications/notifications.integration.spec.ts` — fan-out mock vs. real mode.
- `src/cross-flow.integration.spec.ts` — register → login → trigger → log-row E2E.

### 2.2 Test infrastructure

The shared infra lives at `src/test/`:

- `src/test/createTestApp.ts` — boots a fresh NestApplication with the current schema applied to `nasa_sky_tracker_test`, ready for supertest requests.
- `src/test/resetDb.ts` — `TRUNCATE ... CASCADE` the user-facing tables in a global `beforeEach`. Safe because the DB is dedicated to the test cycle.
- `src/test/nockReset.ts` — `nock.cleanAll()` between specs.

A typical spec pattern:

```ts
import { createTestApp, resetDb } from '../test/...';

describe('ApodController (integration)', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('returns today after a fetch', async () => {
    nock('https://api.nasa.gov').get('/planetary/apod').reply(200, realFixture);
    return request(app.getHttpServer())
      .get('/api/nasa/apod/today')
      .expect(200)
      .expect((res) => expect(res.body.date).toBe(todayUtc()));
  });
});
```

### 2.3 Test DB

| DB name                | Owner | Used by                   |
| ---------------------- | ----- | ------------------------- |
| `nasa_sky_tracker`     | dev   | local dev + scheduled jobs |
| `nasa_sky_tracker_test`| test  | Jest specs only           |

`services.yaml`'s `test_db` service creates/nukes the test DB idempotently:

```bash
# create (no-op if exists)
docker compose exec -T db createdb -U postgres nasa_sky_tracker_test || true
# smoke
PGPASSWORD=pass123 psql -h localhost -U postgres -d nasa_sky_tracker_test -c "SELECT 1"
```

### 2.4 HTTP mocking — `nock`

Default for unit + integration tests:

- Use `nock` for all NASA endpoints in Jest specs.
- Always set `Content-Type` and matching query strings on the matcher.
- Reset `nock` per spec via `nockReset()`.

### 2.5 Gotcha: testing timeouts

`nock`'s `ClientRequest` mock does **not** honor `req.setTimeout()` for `.delay()`/`.delayConnection()`. To exercise the timeout/error path (e.g., `VAL-APOD-009`, `VAL-EONET-008`), spin up a real local slow HTTP server in the spec:

```ts
import { createServer } from 'http';
import type { AddressInfo } from 'net';

function startSlowServer(delayMs: number): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer(() => { /* never reply */ });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      setTimeout(() => server.close(), delayMs);
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

it('timeout fires without crashing the scheduler', async () => {
  const slow = await startSlowServer(20_000);
  process.env.APOD_BASE_URL = slow.url;
  // …build app, expect scheduler to log timeout and recover on next tick…
  slow.close();
});
```

The `NasaClientService` deliberately accepts `APOD_BASE_URL`/`EONET_BASE_URL` overrides so specs can point at this local server.

### 2.6 Gotcha: TypeORM `innerJoin` metadata error

When you join across two entities in a custom query, TypeORM sometimes throws:

```
Cannot read properties of undefined (reading 'databaseName')
```

during `getMany()` against the relation join path. The productive workaround used throughout the codebase is a **subquery** instead of `innerJoin`:

```ts
return this.notificationsRepo.find({
  where: { subscriberId: In(
    this.subscribersRepo.createQueryBuilder('s')
      .select('s.id').where('s.ownerId = :userId', { userId }).getQuery()
  )},
  order: { deliveredAt: 'DESC' },
  skip: (page - 1) * limit, take: limit,
});
```

A full working example is in `src/notifications/notifications.service.ts → listForOwner`.

### 2.7 Gotcha: Jest 30 flag rename

Jest 30 renamed `--testPathPattern` → `--testPathPatterns` (with the trailing `s`). The mission includes `scripts/jest.js` which transparently maps the legacy flag back to the new one. To run scoped tests:

```bash
npm test -- --testPathPattern auth            # runs anything matching /auth/
npm test -- --testPathPattern nasa            # all NASA specs
npm test -- --testPathPattern subscribers     # subscriber + test-notification specs
```

The full-suite gate command is the bare:

```bash
npm test                                      # all suites serial (maxWorkers: 1 — see §2.8)
```

### 2.8 Gotcha: `maxWorkers: 1` (do not change)

Backend specs run serially:

```jsonc
// package.json -> jest
"maxWorkers": 1
```

Reason: every Jest worker shares the same `nasa_sky_tracker_test` DB; parallel workers TRUNCATE each other's fixtures. Do not raise this without re-validating all suites in parallel first.

### 2.9 Pre-existing modules (off-limits)

The only remaining pre-existing off-limits module is `src/customers/**`, excluded from eslint via `eslint.config.mjs → ignores`. Do not modify it in feature work; the only documented carve-out is a single `@Public()` decorator addition to preserve its pre-existing public accessibility under the new global JwtAuthGuard.

---

## 3. Frontend tests (Vitest + RTL + MSW)

### 3.1 Where specs live

Frontend specs mirror the source tree under `web/src/`:

- `web/src/auth/auth.test.tsx` — AuthProvider bootstrap + ProtectedRoute + 401 interceptor.
- `web/src/pages/Login.test.tsx`, `Register.test.tsx` — form validation + 401/409 surfacing + redirect to `from`.
- `web/src/pages/Home.test.tsx`, `ApodArchive.test.tsx`, `EonetFeed.test.tsx`, `NotificationsLog.test.tsx`, `Subscribers.test.tsx` — page-level render, filter, skeleton, error+retry, empty-state, XSS-safety, long-title truncation, video-iframe branch.

### 3.2 MSW handlers

`web/src/test/server.ts` boots MSW 2 with `onUnhandledRequest: 'error'` and a catch-all that returns `500 'NO HANDLER REGISTERED'`. Per-spec MSW handlers are defined inline:

```ts
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';

it('renders the hero image', async () => {
  server.use(
    http.get('/api/nasa/apod/today', () =>
      HttpResponse.json({ date: todayUtc(), title: 'X', mediaType: 'image',
                          url: 'https://apod.nasa.gov/x.jpg', explanation: 'lipsum' })),
  );
  render(<Home />, { wrapper: providers });
  expect(await screen.findByAltText('X')).toBeInTheDocument();
});
```

### 3.3 Provider wrapper

`web/src/test/render.tsx` exports a `Providers` wrapper that mounts `QueryClientProvider`, `AuthProvider`, and MemoryRouter in one call. Use it everywhere — without it, `useQuery`/`useNavigate`/`<Navigate/>` will throw.

### 3.4 JWT URL hygiene

`web/src/api/client.ts` attaches the JWT via an `Authorization: Bearer ${token}` axios interceptor; the 401 path clears the token and redirects to `/login` (skipping the redirect on `/login` and `/register` to avoid loops). Tests confirm that the JWT never appears in `window.location` (query or hash) under any path.

### 3.5 Test name conventions

Prefer behavior-style names that mirror the assertion they cover:

```ts
it('VAL-FE-HOME-001 renders title and image for an image entry', ...)
it('VAL-FE-AUTH-010 401 interceptor clears token and redirects to /login', ...)
```

This makes a green Vitest run a self-documenting evidence trail when folded into the validation report.

### 3.6 Cross-page UX helpers

Reuse `Skeleton`, `EmptyState`, `ErrorState` from `web/src/components/`. Each page:

- shows `<Skeleton/>` while the primary fetch is pending,
- shows `<EmptyState/>` when the array is empty in zero-total mode (`data-variant="zero"`) AND when a filter doesn't match anything (`data-variant="filtered"`),
- shows `<ErrorState/>` with a Retry button on 5xx.

---

## 4. Live end-to-end tests

These are run by the milestone user-testing validators (and by you, when you want to verify a release candidate). They are *not* part of `npm test` — they require a running stack.

### 4.1 Bring up the stack

```bash
# in one shell
npm run dev

# in another
curl -sf http://localhost:3000/api/nasa/health   # 200 {status:ok,db:up,nasaReachable:true}
curl -sf http://localhost:5173                   # 200, Vite index.html
```

### 4.2 curl scenarios

```bash
# register + login
curl -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse"}'

JWT=$(curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse"}' \
  | jq -r .accessToken)

# subs / EONET / notifications (use the JWT)
curl -H "Authorization: Bearer $JWT" http://localhost:3000/api/subscribers
curl http://localhost:3000/api/nasa/eonet/events?status=open&page=1
curl -H "Authorization: Bearer $JWT" http://localhost:3000/api/notifications?limit=100
```

### 4.3 psql sanity checks

```bash
PGPASSWORD=pass123 psql -h localhost -U postgres -d nasa_sky_tracker -c \
  "SELECT date, media_type, video_url FROM apod_entries ORDER BY date DESC LIMIT 5"

PGPASSWORD=pass123 psql -h localhost -U postgres -d nasa_sky_tracker -c \
  "SELECT count(*) AS total, count(*) FILTER (WHERE geometry <>'[]'::jsonb) AS with_geom FROM eonet_events"

PGPASSWORD=pass123 psql -h localhost -U postgres -d nasa_sky_tracker -c \
  "SELECT source, status, count(*) FROM notification_log GROUP BY 1,2 ORDER BY 1,2"
```

Webhook privacy invariant: `psql -tAc "SELECT count(*) FROM notification_log WHERE payload::text LIKE '%discord.com/api/webhooks%'"` should be `0` (only redacted `/webhooks/.../<last-4>` form is ever persisted).

### 4.4 agent-browser flows

The `user-testing-validator` droid is the canonical harness for live browser flows. When you need a manual run:

```bash
# from any working dir with agent-browser on PATH
agent-browser open http://localhost:5173
agent-browser snapshot                # accessibility tree
agent-browser network                 # HAR-like recent requests
agent-browser screenshot              # rendered DOM
```

Concurrency ceiling: max 3 parallel agent-browser sessions on the shared Chrome pane; for more, launch headless isolated sessions (`agent-browser open --headless`).

---

## 5. Conventions every new test should follow

- **TDD**: write a failing spec first, then watch it pass after code, then refactor.
- **Test isolation**: `resetDb` between backend specs; `server.resetHandlers()` and `cleanup()` between frontend specs; never share build-time state across specs.
- **No flakiness**: never depend on wall-clock `setTimeout` for assertions; use `nock`-delay only for *output* throttling, and prefer signal-based synchronization.
- **No live secrets** in test fixtures; fake JWTs are fine for the global guard, but the real `JWT_SECRET` is per-boot random in dev for safety.
- **Redact webhook URLs** in any payload that lands in a fixture or in `expect(...).toMatchObject` matching.

---

## 6. Troubleshooting matrix

| Symptom                                              | Root cause                                                                         | Fix                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Cannot read properties of undefined (reading 'databaseName')` on `getMany` | TypeORM innerJoin metadata error                                              | Use a subquery as in §2.6                                                                                       |
| `nock` doesn't honor `.delay(...)` for timeout specs | nock.ClientRequest ignores req.setTimeout                                         | Use a real local slow http server as in §2.5; remember `APOD_BASE_URL`/`EONET_BASE_URL` overrides |
| `npm test` hangs                                        | Parallel workers sharing one test DB                                          | Confirm `package.json -> jest.maxWorkers: 1`; do not raise without re-validating in parallel                                            |
| Validation log flush in jest output                   | Negative-path spec intentionally triggers retry/timeout logs                     | Expected; the spec asserts the log line and the test still passes                                                                                |
| Agent-browser screenshot times out (concurrent runs)  | Shared CDP pane contention                                                       | Launch headless isolated sessions; DOM/HAR evidence is also acceptable |

---

## 7. TDD workflow (TL;DR)

1. Read the feature's `description`, `preconditions`, `expectedBehavior`, `fulfills`.
2. Read `validation-contract.md` for each `fulfills` ID.
3. Read the relevant `architecture.md` section.
4. Write a failing `*.spec.ts` against the real test DB (or against the FE MSW handler set).
5. Run scoped: at root, `npm test -- --testPathPattern <area>`; in web, `cd web && npm run test -- --run --testNamePattern <name>`.
6. Implement the minimum code to pass.
7. Re-run scoped; refactor.
8. Run full gate: `npm test` (root) + `cd web && npm run test --run`.
9. Run `npm run typecheck` and `npm run lint` on the touched surface.
10. Manual verification (curl, psql, agent-browser) for each cross-area claim.
