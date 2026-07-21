import { DataSource } from 'typeorm';

/**
 * Truncates every table backing a registered entity (including M2M junction
 * tables) in the connected datasource, resetting identity sequences. Intended
 * for the dedicated test database only; callers wire this into a global
 * `beforeEach` to isolate tests.
 */
export async function resetDb(dataSource: DataSource): Promise<void> {
  const tableNames = [
    ...new Set(dataSource.entityMetadatas.map((meta) => `"${meta.tableName}"`)),
  ];

  if (tableNames.length === 0) {
    return;
  }

  await dataSource.query(
    `TRUNCATE ${tableNames.join(', ')} RESTART IDENTITY CASCADE`,
  );
}
