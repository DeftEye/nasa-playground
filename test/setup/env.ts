process.env.NODE_ENV = 'test';
process.env.POSTGRES_DB =
  process.env.POSTGRES_DB_TEST ?? 'nasa_sky_tracker_test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';
// Disable the APOD scheduler's on-boot NASA fetch during tests so the
// integration test app does not fire live/unguarded NASA requests on boot.
// Scheduler behavior is exercised directly in apod.scheduler.spec.ts.
process.env.APOD_BOOT_CATCHUP = 'false';
// Disable the EONET scheduler's on-boot NASA fetch during tests for the same
// reason. EONET scheduler behavior is exercised directly in
// eonet.scheduler.spec.ts.
process.env.EONET_BOOT_CATCHUP = 'false';
// Enforce JWT auth in the test app regardless of the local .env (which may
// set AUTH_REQUIRED=false for dev smoke testing). The validation contract
// expects JWT-guarded scoping (e.g. VAL-NOTIF-009, VAL-AUTH-012); without
// this, the global GlobalJwtAuthGuard short-circuits and never populates
// `req.user`, crashing controllers that rely solely on the global guard
// (e.g. NotificationsController). Public reads (EONET, APOD today, health,
// events/map) are marked @Public() and remain accessible without a JWT.
process.env.AUTH_REQUIRED = 'true';
