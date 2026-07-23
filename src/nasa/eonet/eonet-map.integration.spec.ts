import { DataSource } from 'typeorm';
import { Response } from 'supertest';
import {
  closeTestApp,
  createTestApp,
  resetDb,
  TestAppContext,
} from '../../../test/utils';

/**
 * Integration specs for the M9 map endpoint `GET /api/nasa/eonet/events/map`
 * (architecture §16.1). Seeds `eonet_events` / `eonet_categories` / junction
 * rows directly via SQL (mirroring `eonet.integration.spec.ts` patterns) and
 * asserts the VAL-MAP-001..025 behaviors against the real test DB.
 */

interface MapWindow {
  days: number;
  from: string;
  to: string;
}

interface MapCategory {
  id: string;
  title: string;
}

interface MapEvent {
  id: string;
  title: string;
  status: string;
  date: string;
  lat: number;
  lng: number;
  link: string;
  categories: MapCategory[];
}

interface MapBody {
  window: MapWindow;
  events: MapEvent[];
}

const asMap = (res: Response): MapBody => res.body as MapBody;

const hours = (n: number) => n * 60 * 60 * 1000;
const days = (n: number) => n * 24 * hours(1);

/** ISO string for `now - ms`. */
function isoAgo(ms: number, now = new Date()): string {
  return new Date(now.getTime() - ms).toISOString();
}

/** Builds a Point geometry observation array. */
function pointGeometry(coords: [number, number], dateIso?: string): unknown[] {
  const obs: Record<string, unknown> = {
    type: 'Point',
    coordinates: coords,
  };
  if (dateIso !== undefined) {
    obs.date = dateIso;
  }
  return [obs];
}

/** Builds a Polygon geometry observation array from an outer ring. */
function polygonGeometry(
  ring: Array<[number, number]>,
  dateIso?: string,
): unknown[] {
  const closed = ring[0] && ring[ring.length - 1] ? ring : ring;
  const obs: Record<string, unknown> = {
    type: 'Polygon',
    coordinates: [closed],
  };
  if (dateIso !== undefined) {
    obs.date = dateIso;
  }
  return [obs];
}

/** Builds a MultiPolygon geometry observation array. */
function multiPolygonGeometry(
  polygons: Array<Array<[number, number]>>,
  dateIso?: string,
): unknown[] {
  const obs: Record<string, unknown> = {
    type: 'MultiPolygon',
    coordinates: polygons.map((r) => [r]),
  };
  if (dateIso !== undefined) {
    obs.date = dateIso;
  }
  return [obs];
}

/** Inserts an event row + its category links. */
async function seedEvent(
  ds: DataSource,
  opts: {
    id: string;
    title?: string;
    status?: 'open' | 'closed';
    firstSeenAt?: Date;
    geometry: unknown;
    categoryIds?: string[];
  },
): Promise<void> {
  const now = new Date();
  const fs = opts.firstSeenAt ?? now;
  await ds.query(
    `INSERT INTO eonet_events (id, title, description, link, status, closed_at, first_seen_at, last_seen_at, geometry)
     VALUES ($1, $2, NULL, $3, $4, NULL, $5, $5, $6)`,
    [
      opts.id,
      opts.title ?? `Event ${opts.id}`,
      `https://eonet.gsfc.nasa.gov/api/v3/events/${opts.id}`,
      opts.status ?? 'open',
      fs,
      JSON.stringify(opts.geometry),
    ],
  );
  for (const cid of opts.categoryIds ?? []) {
    await ds.query(
      'INSERT INTO eonet_event_categories (event_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [opts.id, cid],
    );
  }
}

async function seedCategories(
  ds: DataSource,
  cats: Array<{ id: string; title: string }>,
): Promise<void> {
  for (const c of cats) {
    await ds.query(
      'INSERT INTO eonet_categories (id, title, description) VALUES ($1, $2, NULL) ON CONFLICT (id) DO NOTHING',
      [c.id, c.title],
    );
  }
}

describe('EONET map endpoint (integration)', () => {
  let context: TestAppContext;
  let dataSource: DataSource;

  beforeAll(async () => {
    context = await createTestApp();
    dataSource = context.dataSource;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    await resetDb(dataSource);
  });

  // VAL-MAP-001 / VAL-MAP-002
  it('GET /api/nasa/eonet/events/map returns 200 without a JWT with the {window, events} envelope', async () => {
    await seedCategories(dataSource, [{ id: 'wildfires', title: 'Wildfires' }]);
    await seedEvent(dataSource, {
      id: 'EONET_MAP_1',
      title: 'Wildfire - Test',
      geometry: pointGeometry([123.456, -45.67], isoAgo(days(5))),
      categoryIds: ['wildfires'],
    });

    const res = await context.http.get('/api/nasa/eonet/events/map');
    expect(res.status).toBe(200);
    const body = asMap(res);
    expect(body.window).toBeDefined();
    expect(body.events).toBeInstanceOf(Array);
    // Bare object, not the paginated list envelope.
    expect((body as unknown as Record<string, unknown>).page).toBeUndefined();
    expect((body as unknown as Record<string, unknown>).limit).toBeUndefined();
    expect((body as unknown as Record<string, unknown>).total).toBeUndefined();

    const ev = body.events[0];
    expect(ev.id).toBe('EONET_MAP_1');
    expect(ev.title).toBe('Wildfire - Test');
    expect(ev.status).toBe('open');
    expect(ev.link).toBe(
      'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_MAP_1',
    );
    expect(ev.lat).toBeCloseTo(-45.67, 6);
    expect(ev.lng).toBeCloseTo(123.456, 6);
    // Categories present and non-empty (unlike the list endpoint).
    expect(ev.categories).toBeInstanceOf(Array);
    expect(ev.categories.length).toBe(1);
    expect(ev.categories[0]).toEqual({ id: 'wildfires', title: 'Wildfires' });
  });

  // VAL-MAP-003 / VAL-MAP-004
  it('window bounds match the requested days; default days is 30 when omitted', async () => {
    const now = Date.now();
    const defaultRes = await context.http.get('/api/nasa/eonet/events/map');
    expect(defaultRes.status).toBe(200);
    const def = asMap(defaultRes);
    expect(def.window.days).toBe(30);
    expect(new Date(def.window.to).getTime() - now).toBeLessThan(2000);
    expect(
      new Date(def.window.to).getTime() - new Date(def.window.from).getTime(),
    ).toBeCloseTo(days(30), -2);

    for (const d of [7, 14, 30] as const) {
      const res = await context.http
        .get('/api/nasa/eonet/events/map')
        .query({ days: d });
      expect(res.status).toBe(200);
      const w = asMap(res).window;
      expect(w.days).toBe(d);
      expect(new Date(w.to).getTime() - new Date(w.from).getTime()).toBeCloseTo(
        days(d),
        -2,
      );
    }
  });

  // VAL-MAP-005 (events just inside the window)
  it('includes events whose most-recent observation is just inside the window for each allowed window', async () => {
    await seedCategories(dataSource, [
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    await seedEvent(dataSource, {
      id: 'EONET_IN_7',
      geometry: pointGeometry([0, 0], isoAgo(days(7) - hours(1))),
      categoryIds: ['severeStorms'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_IN_14',
      geometry: pointGeometry([1, 1], isoAgo(days(14) - hours(1))),
      categoryIds: ['severeStorms'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_IN_30',
      geometry: pointGeometry([2, 2], isoAgo(days(30) - hours(1))),
      categoryIds: ['severeStorms'],
    });

    const r7 = asMap(
      await context.http.get('/api/nasa/eonet/events/map').query({ days: 7 }),
    );
    expect(r7.events.map((e) => e.id)).toContain('EONET_IN_7');

    const r14 = asMap(
      await context.http.get('/api/nasa/eonet/events/map').query({ days: 14 }),
    );
    expect(r14.events.map((e) => e.id)).toContain('EONET_IN_14');

    const r30 = asMap(
      await context.http.get('/api/nasa/eonet/events/map').query({ days: 30 }),
    );
    expect(r30.events.map((e) => e.id)).toContain('EONET_IN_30');
  });

  // VAL-MAP-006 (events just outside the window)
  it('excludes events whose most-recent observation is just outside the window', async () => {
    await seedCategories(dataSource, [
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    await seedEvent(dataSource, {
      id: 'EONET_OUT_7',
      geometry: pointGeometry([0, 0], isoAgo(days(7) + hours(1))),
      categoryIds: ['severeStorms'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_OUT_14',
      geometry: pointGeometry([1, 1], isoAgo(days(14) + hours(1))),
      categoryIds: ['severeStorms'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_OUT_30',
      geometry: pointGeometry([2, 2], isoAgo(days(30) + hours(1))),
      categoryIds: ['severeStorms'],
    });

    const r7 = asMap(
      await context.http.get('/api/nasa/eonet/events/map').query({ days: 7 }),
    );
    expect(r7.events.map((e) => e.id)).not.toContain('EONET_OUT_7');

    const r14 = asMap(
      await context.http.get('/api/nasa/eonet/events/map').query({ days: 14 }),
    );
    expect(r14.events.map((e) => e.id)).not.toContain('EONET_OUT_14');

    const r30 = asMap(
      await context.http.get('/api/nasa/eonet/events/map').query({ days: 30 }),
    );
    expect(r30.events.map((e) => e.id)).not.toContain('EONET_OUT_30');
  });

  // VAL-MAP-007
  it('date window uses the most-recent geometry observation date', async () => {
    await seedCategories(dataSource, [
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    await seedEvent(dataSource, {
      id: 'EONET_RECENT',
      geometry: [
        { type: 'Point', coordinates: [1, 2], date: isoAgo(days(40)) },
        { type: 'Point', coordinates: [3, 4], date: isoAgo(days(5)) },
      ],
      categoryIds: ['severeStorms'],
    });

    const res = asMap(
      await context.http.get('/api/nasa/eonet/events/map').query({ days: 7 }),
    );
    expect(res.events.map((e) => e.id)).toContain('EONET_RECENT');
    const ev = res.events.find((e) => e.id === 'EONET_RECENT')!;
    // event.date equals the newer observation date (within 1s).
    expect(new Date(ev.date).getTime()).toBeCloseTo(
      new Date(isoAgo(days(5))).getTime(),
      -3,
    );
  });

  // VAL-MAP-008
  it('date window falls back to firstSeenAt when geometry observation has no date', async () => {
    await seedCategories(dataSource, [
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    const fs = new Date(Date.now() - days(5));
    await seedEvent(dataSource, {
      id: 'EONET_NODATE',
      firstSeenAt: fs,
      geometry: [{ type: 'Point', coordinates: [2.35, 48.85] }],
      categoryIds: ['severeStorms'],
    });

    const res = asMap(
      await context.http.get('/api/nasa/eonet/events/map').query({ days: 7 }),
    );
    expect(res.events.map((e) => e.id)).toContain('EONET_NODATE');
    const ev = res.events.find((e) => e.id === 'EONET_NODATE')!;
    expect(new Date(ev.date).getTime()).toBeCloseTo(fs.getTime(), -3);
  });

  // VAL-MAP-009
  it('category filter returns only events linked to that slug', async () => {
    await seedCategories(dataSource, [
      { id: 'wildfires', title: 'Wildfires' },
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    await seedEvent(dataSource, {
      id: 'EONET_FIRE',
      geometry: pointGeometry([0, 0], isoAgo(days(5))),
      categoryIds: ['wildfires'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_STORM',
      geometry: pointGeometry([1, 1], isoAgo(days(5))),
      categoryIds: ['severeStorms'],
    });

    const res = asMap(
      await context.http
        .get('/api/nasa/eonet/events/map')
        .query({ category: 'wildfires' }),
    );
    expect(res.events).toHaveLength(1);
    expect(res.events[0].id).toBe('EONET_FIRE');
    expect(res.events[0].categories.map((c) => c.id)).toContain('wildfires');
  });

  // VAL-MAP-010
  it('status filter returns only events with that status', async () => {
    await seedCategories(dataSource, [
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    await seedEvent(dataSource, {
      id: 'EONET_OPEN',
      status: 'open',
      geometry: pointGeometry([0, 0], isoAgo(days(5))),
      categoryIds: ['severeStorms'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_CLOSED',
      status: 'closed',
      geometry: pointGeometry([1, 1], isoAgo(days(5))),
      categoryIds: ['severeStorms'],
    });

    const openRes = asMap(
      await context.http
        .get('/api/nasa/eonet/events/map')
        .query({ status: 'open' }),
    );
    expect(openRes.events).toHaveLength(1);
    expect(openRes.events[0].id).toBe('EONET_OPEN');

    const closedRes = asMap(
      await context.http
        .get('/api/nasa/eonet/events/map')
        .query({ status: 'closed' }),
    );
    expect(closedRes.events).toHaveLength(1);
    expect(closedRes.events[0].id).toBe('EONET_CLOSED');
  });

  // VAL-MAP-011
  it('category and status filters applied together as intersection', async () => {
    await seedCategories(dataSource, [
      { id: 'wildfires', title: 'Wildfires' },
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    const seed = [
      ['EONET_WO', 'open', 'wildfires'],
      ['EONET_WC', 'closed', 'wildfires'],
      ['EONET_SO', 'open', 'severeStorms'],
      ['EONET_SC', 'closed', 'severeStorms'],
    ] as const;
    for (const [id, status, cat] of seed) {
      await seedEvent(dataSource, {
        id,
        status,
        geometry: pointGeometry([0, 0], isoAgo(days(5))),
        categoryIds: [cat],
      });
    }

    const res = asMap(
      await context.http.get('/api/nasa/eonet/events/map').query({
        category: 'wildfires',
        status: 'open',
      }),
    );
    expect(res.events).toHaveLength(1);
    expect(res.events[0].id).toBe('EONET_WO');
  });

  // VAL-MAP-012
  it('Point geometry passes its coordinates through in [lng, lat] order', async () => {
    await seedCategories(dataSource, [
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    await seedEvent(dataSource, {
      id: 'EONET_PT',
      geometry: pointGeometry([123.456, -45.67], isoAgo(days(5))),
      categoryIds: ['severeStorms'],
    });
    const res = asMap(await context.http.get('/api/nasa/eonet/events/map'));
    const ev = res.events.find((e) => e.id === 'EONET_PT')!;
    expect(ev.lng).toBeCloseTo(123.456, 6);
    expect(ev.lat).toBeCloseTo(-45.67, 6);
  });

  // VAL-MAP-013
  it('Polygon geometry is reduced to centroid of the outer ring', async () => {
    await seedCategories(dataSource, [
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    await seedEvent(dataSource, {
      id: 'EONET_POLY',
      geometry: polygonGeometry(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        isoAgo(days(5)),
      ),
      categoryIds: ['severeStorms'],
    });
    const res = asMap(await context.http.get('/api/nasa/eonet/events/map'));
    const ev = res.events.find((e) => e.id === 'EONET_POLY')!;
    expect(ev.lng).toBeCloseTo(5, 6);
    expect(ev.lat).toBeCloseTo(5, 6);
  });

  // VAL-MAP-014
  it('MultiPolygon geometry is reduced to mean of the first ring of each polygon', async () => {
    await seedCategories(dataSource, [
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    // Polygon A first ring centroid (-10, 20); Polygon B first ring centroid (30, 40).
    // Mean = (10, 30) for (lng, lat).
    await seedEvent(dataSource, {
      id: 'EONET_MULTI',
      geometry: multiPolygonGeometry(
        [
          [
            [-20, 10],
            [0, 10],
            [0, 30],
            [-20, 30],
            [-20, 10],
          ],
          [
            [20, 30],
            [40, 30],
            [40, 50],
            [20, 50],
            [20, 30],
          ],
        ],
        isoAgo(days(5)),
      ),
      categoryIds: ['severeStorms'],
    });
    const res = asMap(await context.http.get('/api/nasa/eonet/events/map'));
    const ev = res.events.find((e) => e.id === 'EONET_MULTI')!;
    expect(ev.lng).toBeCloseTo(10, 6);
    expect(ev.lat).toBeCloseTo(30, 6);
  });

  // VAL-MAP-015
  it('events with no usable geometry are excluded', async () => {
    await seedCategories(dataSource, [
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    await seedEvent(dataSource, {
      id: 'EONET_NULL_GEOM',
      geometry: null,
      categoryIds: ['severeStorms'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_EMPTY_GEOM',
      geometry: [],
      categoryIds: ['severeStorms'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_NO_COORDS',
      geometry: [{ type: 'Point', date: isoAgo(days(5)) }], // no coordinates
      categoryIds: ['severeStorms'],
    });

    const res = asMap(await context.http.get('/api/nasa/eonet/events/map'));
    expect(res.events.map((e) => e.id)).not.toContain('EONET_NULL_GEOM');
    expect(res.events.map((e) => e.id)).not.toContain('EONET_EMPTY_GEOM');
    expect(res.events.map((e) => e.id)).not.toContain('EONET_NO_COORDS');
  });

  // VAL-MAP-016
  it('longitude is normalized to [-180, 180]', async () => {
    await seedCategories(dataSource, [
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    await seedEvent(dataSource, {
      id: 'EONET_LNG_190',
      geometry: pointGeometry([190.0, 10.0], isoAgo(days(5))),
      categoryIds: ['severeStorms'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_LNG_NEG200',
      geometry: pointGeometry([-200.0, 10.0], isoAgo(days(5))),
      categoryIds: ['severeStorms'],
    });
    const res = asMap(await context.http.get('/api/nasa/eonet/events/map'));
    const a = res.events.find((e) => e.id === 'EONET_LNG_190')!;
    expect(a.lng).toBeCloseTo(-170, 6);
    const b = res.events.find((e) => e.id === 'EONET_LNG_NEG200')!;
    expect(b.lng).toBeCloseTo(160, 6);
  });

  // VAL-MAP-017
  it('latitude is clamped to [-90, 90]', async () => {
    await seedCategories(dataSource, [
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    await seedEvent(dataSource, {
      id: 'EONET_LAT_95',
      geometry: pointGeometry([10.0, 95.0], isoAgo(days(5))),
      categoryIds: ['severeStorms'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_LAT_NEG95',
      geometry: pointGeometry([10.0, -95.0], isoAgo(days(5))),
      categoryIds: ['severeStorms'],
    });
    const res = asMap(await context.http.get('/api/nasa/eonet/events/map'));
    const a = res.events.find((e) => e.id === 'EONET_LAT_95')!;
    expect(a.lat).toBe(90);
    const b = res.events.find((e) => e.id === 'EONET_LAT_NEG95')!;
    expect(b.lat).toBe(-90);
  });

  // VAL-MAP-018
  it('invalid days value returns 400', async () => {
    const res = await context.http
      .get('/api/nasa/eonet/events/map')
      .query({ days: 5 });
    expect(res.status).toBe(400);
  });

  // VAL-MAP-019
  it('invalid status value returns 400', async () => {
    const res = await context.http
      .get('/api/nasa/eonet/events/map')
      .query({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  // VAL-MAP-020
  it('unknown category slug returns 200 with empty events and a valid window', async () => {
    await seedCategories(dataSource, [{ id: 'wildfires', title: 'Wildfires' }]);
    await seedEvent(dataSource, {
      id: 'EONET_FIRE',
      geometry: pointGeometry([0, 0], isoAgo(days(5))),
      categoryIds: ['wildfires'],
    });
    const res = asMap(
      await context.http
        .get('/api/nasa/eonet/events/map')
        .query({ category: 'notASeededSlug' }),
    );
    expect(res.events).toEqual([]);
    expect(res.window.days).toBe(30);
    expect(res.window.from).toBeDefined();
    expect(res.window.to).toBeDefined();
  });

  // VAL-MAP-021
  it('events are ordered by observation date DESC then id ASC', async () => {
    await seedCategories(dataSource, [
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    await seedEvent(dataSource, {
      id: 'EONET_D2',
      geometry: pointGeometry([0, 0], isoAgo(days(2))),
      categoryIds: ['severeStorms'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_D1',
      geometry: pointGeometry([0, 0], isoAgo(days(1))),
      categoryIds: ['severeStorms'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_D3',
      geometry: pointGeometry([0, 0], isoAgo(days(3))),
      categoryIds: ['severeStorms'],
    });

    const res = asMap(await context.http.get('/api/nasa/eonet/events/map'));
    expect(res.events.map((e) => e.id)).toEqual([
      'EONET_D1',
      'EONET_D2',
      'EONET_D3',
    ]);
  });

  // VAL-MAP-021 (tie-break by id ASC)
  it('ties in observation date are broken by id ascending', async () => {
    await seedCategories(dataSource, [
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    const sameDate = isoAgo(days(5));
    await seedEvent(dataSource, {
      id: 'EONET_Z',
      geometry: pointGeometry([0, 0], sameDate),
      categoryIds: ['severeStorms'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_A',
      geometry: pointGeometry([0, 0], sameDate),
      categoryIds: ['severeStorms'],
    });
    await seedEvent(dataSource, {
      id: 'EONET_M',
      geometry: pointGeometry([0, 0], sameDate),
      categoryIds: ['severeStorms'],
    });
    const res = asMap(await context.http.get('/api/nasa/eonet/events/map'));
    expect(res.events.map((e) => e.id)).toEqual([
      'EONET_A',
      'EONET_M',
      'EONET_Z',
    ]);
  });

  // VAL-MAP-022
  it('empty result set still returns a valid window object', async () => {
    const res = asMap(await context.http.get('/api/nasa/eonet/events/map'));
    expect(res.events).toEqual([]);
    expect(res.window.days).toBe(30);
    expect(res.window.from).toBeDefined();
    expect(res.window.to).toBeDefined();
  });

  // VAL-MAP-023 / VAL-MAP-024
  it('existing /events list endpoint contract and filters are unchanged', async () => {
    await seedCategories(dataSource, [
      { id: 'wildfires', title: 'Wildfires' },
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    const seed = [
      ['EONET_WO', 'open', 'wildfires'],
      ['EONET_WC', 'closed', 'wildfires'],
      ['EONET_SO', 'open', 'severeStorms'],
      ['EONET_SC', 'closed', 'severeStorms'],
    ] as const;
    for (const [id, status, cat] of seed) {
      await seedEvent(dataSource, {
        id,
        status,
        geometry: pointGeometry([0, 0], isoAgo(days(5))),
        categoryIds: [cat],
      });
    }

    // List endpoint still returns the paginated envelope without categories.
    const listRes = await context.http
      .get('/api/nasa/eonet/events')
      .query({ category: 'wildfires', status: 'open', page: 1, limit: 50 });
    expect(listRes.status).toBe(200);
    const list = listRes.body as {
      data: Array<Record<string, unknown>>;
      total: number;
      page: number;
      limit: number;
    };
    expect(list.total).toBe(1);
    expect(list.data[0].id).toBe('EONET_WO');
    // List event objects lack a `categories` key.
    expect(list.data[0].categories).toBeUndefined();
    expect(list.page).toBe(1);
    expect(list.limit).toBe(50);
  });

  // VAL-MAP-025
  it('map endpoint returns multiple categories per event in stable id-ascending order', async () => {
    await seedCategories(dataSource, [
      { id: 'wildfires', title: 'Wildfires' },
      { id: 'severeStorms', title: 'Severe Storms' },
    ]);
    // Insert with severeStorms first to verify the response sorts by id.
    await seedEvent(dataSource, {
      id: 'EONET_MULTI_CAT',
      geometry: pointGeometry([0, 0], isoAgo(days(5))),
      categoryIds: ['severeStorms', 'wildfires'],
    });
    const res = asMap(await context.http.get('/api/nasa/eonet/events/map'));
    const ev = res.events.find((e) => e.id === 'EONET_MULTI_CAT')!;
    expect(ev.categories).toHaveLength(2);
    expect(ev.categories.map((c) => c.id)).toEqual([
      'severeStorms',
      'wildfires',
    ]);
  });
});
