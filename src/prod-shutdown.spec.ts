import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { createTestApp, TestAppContext } from '../test/utils';

/**
 * Integration specs for VAL-HARD-002 (graceful shutdown on SIGTERM).
 *
 * Two assertions:
 *  1. `app.close()` runs the Nest `onApplicationShutdown` lifecycle, which
 *     `@nestjs/typeorm` wires to `dataSource.destroy()` — so the TypeORM
 *     Postgres connection is closed cleanly (no dangling connection).
 *  2. The COMPILED production server (`dist/main.js`), when sent SIGTERM,
 *     exits with code 0 promptly (no forced kill). `main.ts` registers an
 *     explicit SIGTERM handler that awaits `app.close()` (running the
 *     lifecycle + closing the DB) and then calls `process.exit(0)`.
 *
 * The second spec boots `dist/main` against the real `nasa_sky_tracker` DB
 * (synchronize is off in production; tables already exist from prior dev
 * synchronize runs) with both scheduler boot catch-ups disabled, on an
 * ephemeral port (3199) to avoid clashing with the dev `api` service on 3000.
 */
describe('prod graceful shutdown (VAL-HARD-002)', () => {
  const PORT = '3199';
  const mainPath = join(__dirname, '..', 'dist', 'main.js');

  describe('app.close() destroys the TypeORM DataSource', () => {
    let context: TestAppContext | undefined;

    afterEach(async () => {
      // app.close() in the test handles teardown; guard against double-close.
      if (context?.app) {
        await context.app.close();
        context = undefined;
      }
    });

    it('DataSource is initialized before close and torn down after close', async () => {
      context = await createTestApp();
      const dataSource = context.app.get(DataSource);
      expect(dataSource.isInitialized).toBe(true);
      await context.app.close();
      // TypeORM 0.3 has no `isDestroyed` flag; `destroy()` flips
      // `isInitialized` to false once the driver disconnects. The Nest
      // `onApplicationShutdown` hook in `@nestjs/typeorm` calls
      // `dataSource.destroy()`, so a false value here proves the Postgres
      // connection was closed cleanly (no dangling connection).
      expect(dataSource.isInitialized).toBe(false);
      // Mark closed so afterEach doesn't double-close.
      context = undefined;
    });
  });

  describe('compiled dist/main exits 0 on SIGTERM', () => {
    beforeAll(() => {
      if (!existsSync(mainPath)) {
        throw new Error(
          `dist/main.js not found at ${mainPath} — run \`npm run build\` before this spec.`,
        );
      }
    });

    it('process exits with code 0 within 5s of SIGTERM', async () => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: 'production',
        JWT_SECRET: 'prod-shutdown-spec-secret',
        POSTGRES_HOST: 'localhost',
        POSTGRES_PORT: '5432',
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: 'pass123',
        POSTGRES_DB: 'nasa_sky_tracker',
        NASA_API_KEY: 'DEMO_KEY',
        PORT,
        APOD_BOOT_CATCHUP: 'false',
        EONET_BOOT_CATCHUP: 'false',
        DISABLE_NOTIFICATION_MOCK: 'false',
      };

      const child = spawn(process.execPath, [mainPath], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdoutChunks: string[] = [];
      child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c.toString()));
      child.stderr.on('data', (c: Buffer) => stdoutChunks.push(c.toString()));

      // Wait until the server reports it has started (or exits early).
      const started = await new Promise<boolean>((resolve) => {
        const onReady = (chunk: string): void => {
          if (chunk.includes('Nest application successfully started')) {
            child.stdout.off('data', onReady);
            child.stderr.off('data', onReady);
            resolve(true);
          }
        };
        child.stdout.on('data', onReady);
        child.stderr.on('data', onReady);
        child.on('exit', (code) => {
          if (code !== null) resolve(false);
        });
      });

      if (!started) {
        throw new Error(`server did not start. log:\n${stdoutChunks.join('')}`);
      }

      // Give the listener a beat to settle, then send SIGTERM and start a
      // timer to measure promptness.
      await new Promise((r) => setTimeout(r, 200));
      const sentAt = Date.now();
      child.kill('SIGTERM');

      // Wait for exit; fail (SIGKILL) if it hangs beyond 5s. VAL-HARD-002
      // requires a prompt, non-forced exit.
      const result = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
          resolve({ code: null, signal: 'SIGKILL' });
        }, 5_000);
        child.on('exit', (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      });
      const elapsedMs = Date.now() - sentAt;

      // Diagnostic: surface captured output + timing for evidence.

      console.log(
        `--- SIGTERM shutdown: exitCode=${result.code} signal=${result.signal} elapsedMs=${elapsedMs} ---\n${stdoutChunks
          .join('')
          .slice(-800)}`,
      );

      expect(result.code).toBe(0);
      expect(elapsedMs).toBeLessThan(5_000);
    }, 30_000);
  });
});
