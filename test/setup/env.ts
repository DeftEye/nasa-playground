process.env.NODE_ENV = 'test';
process.env.POSTGRES_DB =
  process.env.POSTGRES_DB_TEST ?? 'nasa_sky_tracker_test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';
// Disable the APOD scheduler's on-boot NASA fetch during tests so the
// integration test app does not fire live/unguarded NASA requests on boot.
// Scheduler behavior is exercised directly in apod.scheduler.spec.ts.
process.env.APOD_BOOT_CATCHUP = 'false';
