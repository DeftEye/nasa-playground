import { join } from 'node:path';
import { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import request from 'supertest';
import { configureApp } from './app.setup';
import { buildServeStaticOptions } from './config/serve-static.config';

/**
 * Integration-style spec for the SPA deep-link fallback (VAL-PRODFIX2-001 /
 * VAL-PRODFIX2-002, feature m13-spa-deeplink-fallback).
 *
 * The production served build mounts `ServeStaticModule` against `web/dist`
 * with `exclude: ['/api/(.*)']` and `serveRoot: '/'` only when
 * `NODE_ENV === 'production' && web/dist` exists (see `maybeServeStatic` in
 * `app.module.ts`, which delegates to `buildServeStaticOptions`). In the test
 * environment `NODE_ENV === 'test'`, so static serving is intentionally OFF
 * for the full-AppModule integration harness. To exercise the prod SPA
 * fallback wiring without flipping NODE_ENV (which would also disable TypeORM
 * `synchronize` and require migrations), this spec boots a minimal Nest app
 * that imports `ServeStaticModule.forRoot(...buildServeStaticOptions(fixture))`
 * and applies the SAME `configureApp` used by `main.ts` (global `api` prefix,
 * helmet, validation pipe). The fixture dist stands in for `web/dist`.
 *
 * Asserts:
 *  (a) GET /apod/archive (a non-/api, non-asset client route) -> 200 text/html,
 *      the SPA index.html shell (so React Router renders on refresh / direct
 *      navigation).
 *  (b) GET /api/does-not-exist -> 404 JSON (Nest NotFoundException), NOT the
 *      HTML shell.
 *  (c) GET a real built asset -> 200 with a non-HTML content-type
 *      (text/javascript for the JS bundle).
 */
describe('SPA deep-link fallback (VAL-PRODFIX2-001 / VAL-PRODFIX2-002)', () => {
  const fixtureDist = join(__dirname, '..', 'test', 'fixtures', 'spa-dist');
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    @Module({
      imports: [
        ServeStaticModule.forRoot(...buildServeStaticOptions(fixtureDist)),
      ],
    })
    class SpaFixtureModule {}

    app = await NestFactory.create(SpaFixtureModule, {
      logger: ['error'],
    });
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer() as Server);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('(a) GET /apod/archive returns 200 text/html SPA shell', async () => {
    const res = await http.get('/apod/archive');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    // The served body is the SPA index.html shell, not a JSON 404.
    const body = typeof res.text === 'string' ? res.text : String(res.body);
    expect(body).toContain('SPA_FIXTURE_SHELL');
    expect(body).not.toContain('statusCode');
  });

  it('(a) GET /globe and /login also return 200 text/html SPA shell', async () => {
    for (const path of ['/globe', '/login', '/eonet']) {
      const res = await http.get(path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      const body = typeof res.text === 'string' ? res.text : String(res.body);
      expect(body).toContain('SPA_FIXTURE_SHELL');
    }
  });

  it('(b) GET /api/does-not-exist returns 404 JSON, NOT the HTML shell', async () => {
    const res = await http.get('/api/does-not-exist');
    expect(res.status).toBe(404);
    const ct = res.headers['content-type'];
    expect(ct).toMatch(/application\/json/);
    expect(ct).not.toMatch(/text\/html/);
    // Nest NotFoundException JSON shape.
    expect(res.body).toMatchObject({
      statusCode: 404,
    });
    // Must not be the SPA shell.
    const body = typeof res.text === 'string' ? res.text : '';
    expect(body).not.toContain('SPA_FIXTURE_SHELL');
  });

  it('(c) GET a real built asset serves with a non-HTML content-type', async () => {
    const res = await http.get('/assets/app.js');
    expect(res.status).toBe(200);
    const ct = res.headers['content-type'];
    expect(ct).toBeDefined();
    expect(ct).not.toMatch(/text\/html/);
    // express.static serves JS as text/javascript (or application/javascript).
    expect(ct).toMatch(/javascript/);
  });

  it('(c) GET the CSS asset serves with text/css content-type', async () => {
    const res = await http.get('/assets/app.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
  });

  it('GET / returns 200 text/html SPA shell (the real index)', async () => {
    const res = await http.get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    const body = typeof res.text === 'string' ? res.text : String(res.body);
    expect(body).toContain('SPA_FIXTURE_SHELL');
  });
});
