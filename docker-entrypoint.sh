#!/bin/sh
# Production container entrypoint (VAL-DOCKER-003/005).
#
# Runs the compiled TypeORM migration runner (`dist/migration-runner.js`,
# no ts-node) to apply pending migrations against the configured Postgres,
# then boots the NestJS API. `NODE_ENV=production` => `synchronize` is off in
# `AppModule`, so the schema comes solely from migrations.
#
# If migrations fail, the entrypoint exits non-zero and the app never starts
# (Docker restart policy will retry). We never fall back to synchronize.
set -e

echo "[entrypoint] Running migrations (NODE_ENV=${NODE_ENV:-unset})..."
node dist/migration-runner.js

echo "[entrypoint] Migrations applied. Starting API..."
exec "$@"
