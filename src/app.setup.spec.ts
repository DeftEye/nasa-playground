import nock from 'nock';
import { DataSource } from 'typeorm';
import {
  closeTestApp,
  createTestApp,
  resetDb,
  TestAppContext,
} from '../test/utils';

/**
 * TDD spec for production-hardening middleware applied in `configureApp`
 * (VAL-HARD-001, VAL-PRODFIX-001/002/003).
 *
 * `helmet` is mounted globally with a CSP that STARTS FROM helmet's defaults
 * and only widens img-src (https://apod.nasa.gov) and frame-src (YouTube +
 * Vimeo). Every HTTP response therefore still carries helmet's default
 * security header set (X-Content-Type-Options: nosniff and friends) AND a
 * Content-Security-Policy whose default-src stays 'self' while img-src /
 * frame-src permit the external APOD media hosts.
 */
describe('app.setup / helmet security headers (VAL-HARD-001, VAL-PRODFIX-001/002/003)', () => {
  let context: TestAppContext;
  let dataSource: DataSource;

  beforeAll(async () => {
    context = await createTestApp();
    dataSource = context.dataSource;
    process.env.NASA_API_KEY = 'test-key';
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    nock.cleanAll();
    await resetDb(dataSource);
  });

  /**
   * CSP directive values are sent as a single header value joined by `; `.
   * Parse the Content-Security-Policy header into a {directive: [sources]} map
   * so individual directives can be asserted without ordering concerns.
   */
  function parseCsp(headerValue: string | undefined): Record<string, string[]> {
    expect(headerValue).toBeDefined();
    const map: Record<string, string[]> = {};
    for (const part of (headerValue as string).split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const tokens = trimmed.split(/\s+/);
      const name = tokens[0];
      map[name] = tokens.slice(1);
    }
    return map;
  }

  it('responses include X-Content-Type-Options: nosniff and helmet default headers', async () => {
    // The health endpoint reaches NASA; nock it so the boot-time call is
    // deterministic. The header assertion is independent of the body shape.
    nock('https://api.nasa.gov').get('/planetary/apod').query(true).reply(200, {
      date: '2024-01-01',
      title: 'Probe',
      explanation: 'probe',
      url: 'https://example.com/x.jpg',
      media_type: 'image',
    });

    const res = await context.http.get('/api/nasa/health');

    // Contract minimum: X-Content-Type-Options: nosniff.
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // A second helmet default to guard against accidental helmet removal.
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    // Helmet sets Strict-Transport-Security by default as well.
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('CSP default-src stays "self" and helmet-default directives remain (VAL-PRODFIX-003)', async () => {
    nock('https://api.nasa.gov').get('/planetary/apod').query(true).reply(200, {
      date: '2024-01-01',
      title: 'Probe',
      explanation: 'probe',
      url: 'https://example.com/x.jpg',
      media_type: 'image',
    });

    const res = await context.http.get('/api/nasa/health');
    const csp = parseCsp(res.headers['content-security-policy']);

    // default-src must remain 'self' (no widening of the global default).
    expect(csp['default-src']).toEqual(["'self'"]);
    // Other helmet-default directives stay at their defaults.
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    // Helmet default header set still present alongside the customized CSP.
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('CSP img-src includes self, data:, and https://apod.nasa.gov (VAL-PRODFIX-001)', async () => {
    nock('https://api.nasa.gov').get('/planetary/apod').query(true).reply(200, {
      date: '2024-01-01',
      title: 'Probe',
      explanation: 'probe',
      url: 'https://apod.nasa.gov/x.jpg',
      media_type: 'image',
    });

    const res = await context.http.get('/api/nasa/health');
    const csp = parseCsp(res.headers['content-security-policy']);

    expect(csp['img-src']).toEqual([
      "'self'",
      'data:',
      'https://apod.nasa.gov',
    ]);
  });

  it('CSP frame-src permits YouTube and Vimeo embeds (VAL-PRODFIX-002)', async () => {
    nock('https://api.nasa.gov').get('/planetary/apod').query(true).reply(200, {
      date: '2024-01-01',
      title: 'Probe',
      explanation: 'probe',
      url: 'https://example.com/x.jpg',
      media_type: 'image',
    });

    const res = await context.http.get('/api/nasa/health');
    const csp = parseCsp(res.headers['content-security-policy']);

    expect(csp['frame-src']).toEqual([
      'https://www.youtube.com',
      'https://www.youtube-nocookie.com',
      'https://player.vimeo.com',
    ]);
  });
});
