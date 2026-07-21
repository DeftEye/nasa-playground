process.env.NODE_ENV = 'test';
process.env.POSTGRES_DB =
  process.env.POSTGRES_DB_TEST ?? 'nasa_sky_tracker_test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';
