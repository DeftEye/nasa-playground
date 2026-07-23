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
 * (VAL-HARD-001).
 *
 * `helmet` is mounted globally so every HTTP response carries helmet's default
 * security header set. We assert at minimum `X-Content-Type-Options: nosniff`
 * is present (the contract minimum) plus another helmet default
 * (`X-DNS-Prefetch-Control`) to guard against accidental removal of the
 * `app.use(helmet())` wiring.
 */
describe('app.setup / helmet security headers (VAL-HARD-001)', () => {
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
});
