import AppDataSource from './data-source';

/**
 * Compiled migration runner for production. `nest build` emits this to
 * `dist/migration-runner.js`; the production container entrypoint runs
 * `node dist/migration-runner.js` (no ts-node) to apply pending migrations
 * before booting the API via `node dist/main`.
 *
 * In dev the npm scripts (`migration:run` / `migration:revert`) use the
 * typeorm CLI with ts-node against `src/data-source.ts` instead.
 */
async function runMigrations(): Promise<void> {
  await AppDataSource.initialize();
  await AppDataSource.runMigrations({ transaction: 'each' });
  await AppDataSource.destroy();
}

void runMigrations().catch((err: unknown) => {
  console.error('Migration run failed:', err);
  process.exitCode = 1;
});
