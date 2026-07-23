import { DataSource } from 'typeorm';
import AppDataSource from '../data-source';
import { InitialSchema1784792437520 } from './1784792437520-InitialSchema';

/**
 * Regression guard for the M6 migration infrastructure (VAL-MIG-001).
 *
 * The standalone `DataSource` used by the migration CLI must have
 * `synchronize: false` (schema is versioned via migrations, never auto-synced
 * from this file) and must carry non-empty entity + migration globs so the
 * CLI can discover both. The initial migration must expose reversible
 * `up`/`down` methods (VAL-MIG-004).
 *
 * These are pure structural checks — no database connection is opened.
 */
describe('Migration infrastructure', () => {
  it('AppDataSource is a DataSource with synchronize disabled', () => {
    expect(AppDataSource).toBeInstanceOf(DataSource);
    expect(AppDataSource.options.synchronize).toBe(false);
  });

  it('AppDataSource targets the same postgres driver as AppModule', () => {
    expect(AppDataSource.options.type).toBe('postgres');
  });

  it('AppDataSource carries non-empty entity and migration globs', () => {
    const entities = AppDataSource.options.entities;
    const migrations = AppDataSource.options.migrations;
    expect(Array.isArray(entities)).toBe(true);
    expect(Array.isArray(migrations)).toBe(true);
    expect((entities as unknown[]).length).toBeGreaterThan(0);
    expect((migrations as unknown[]).length).toBeGreaterThan(0);
  });

  it('entity globs are scoped to mission modules (exclude customers/snowflake)', () => {
    const entities = AppDataSource.options.entities as string[];
    const joined = entities.join('\n');
    expect(joined).toMatch(/users/);
    expect(joined).toMatch(/nasa/);
    expect(joined).toMatch(/subscribers/);
    expect(joined).toMatch(/notifications/);
    // Legacy off-limits modules must NOT be versioned by the migration system.
    expect(joined).not.toMatch(/customers/);
    expect(joined).not.toMatch(/snowflake/);
  });

  it('initial migration is reversible (exposes up and down)', () => {
    const migration = new InitialSchema1784792437520();
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });
});
