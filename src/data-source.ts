import { DataSource } from 'typeorm';

/**
 * Standalone TypeORM `DataSource` used by the migration CLI.
 *
 * It reads the same `POSTGRES_*` env vars as `AppModule` so the migration
 * system always operates on the same database the application uses.
 * `synchronize` is hard-coded to `false` here — schema changes flow only
 * through versioned migrations, never through auto-sync from this file.
 *
 * `entities` and `migrations` are resolved relative to this file (`__dirname`)
 * so the SAME source file works in two contexts:
 *   - dev: `typeorm-ts-node-commonjs ... -d src/data-source.ts` → `__dirname`
 *     is `src/`, globs match `*.entity.ts` / `migrations/*.ts`.
 *   - prod: `node dist/migration-runner.js` (compiled) → `__dirname` is
 *     `dist/`, globs match `*.entity.js` / `migrations/*.js`.
 *
 * See `library/prod-deploy.md` for the generate/run/revert workflow.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  username: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'pass123',
  database: process.env.POSTGRES_DB ?? 'nasa_sky_tracker',
  // Mission entities only — `src/customers/**` and `src/snowflake/**` are
  // off-limits legacy modules (AGENTS.md) and are intentionally NOT versioned
  // by this migration system. Globs are `__dirname`-relative so the same file
  // works under ts-node (`src/`, matches `*.ts`) and compiled (`dist/`,
  // matches `*.js`).
  entities: [
    `${__dirname}/users/entities/*.entity.{ts,js}`,
    `${__dirname}/nasa/**/entities/*.entity.{ts,js}`,
    `${__dirname}/subscribers/entities/*.entity.{ts,js}`,
    `${__dirname}/notifications/entities/*.entity.{ts,js}`,
  ],
  migrations: [`${__dirname}/migrations/*.{ts,js}`],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
});
