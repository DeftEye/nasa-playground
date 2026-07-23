import { describe, it, expect } from 'vitest';
import type { Feature, Polygon } from 'geojson';
import {
  pointInCountry,
  eventsInCountry,
  withinWindow,
  filterEvents,
  categoryColor,
  knownCategorySlugs,
  type CountryFeature,
} from './geo';
import type { EonetMapEvent } from '../../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A small square polygon approximating France's bounding box
 * `[-5..10 lng, 41..51 lat]` (closed ring). Paris `[2.35, 48.85]` is inside,
 * London `[-0.12, 51.5]` is outside (lat > 51), and New York is far outside.
 */
const FRANCE_SQUARE: Feature<Polygon, Record<string, unknown>> = {
  type: 'Feature',
  properties: { ADMIN: 'France', ADM0_A3: 'FRA' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-5, 41],
        [10, 41],
        [10, 51],
        [-5, 51],
        [-5, 41],
      ],
    ],
  },
};

const franceFeature: CountryFeature = FRANCE_SQUARE as CountryFeature;

const NOW = new Date('2026-07-23T12:00:00.000Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function makeEvent(
  id: string,
  overrides: Partial<EonetMapEvent> = {},
): EonetMapEvent {
  return {
    id,
    title: `Event ${id}`,
    status: 'open',
    date: '2026-07-20T00:00:00.000Z',
    lat: 48.85,
    lng: 2.35,
    link: `https://eonet.gsfc.nasa.gov/api/v3/events/${id}`,
    categories: [{ id: 'wildfires', title: 'Wildfires' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// pointInCountry
// ---------------------------------------------------------------------------

describe('pointInCountry', () => {
  it('includes a point inside the polygon (Paris in France square)', () => {
    expect(pointInCountry(2.35, 48.85, franceFeature)).toBe(true);
  });

  it('excludes a point outside the polygon (London)', () => {
    expect(pointInCountry(-0.12, 51.5, franceFeature)).toBe(false);
  });

  it('excludes a far-away point (New York)', () => {
    expect(pointInCountry(-74.0, 40.7, franceFeature)).toBe(false);
  });

  it('honors [lng, lat] argument order (swapped args give a different result)', () => {
    // Paris [2.35 lng, 48.85 lat] is inside; passing them swapped
    // [48.85 lng, 2.35 lat] is outside this square.
    expect(pointInCountry(48.85, 2.35, franceFeature)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// eventsInCountry
// ---------------------------------------------------------------------------

describe('eventsInCountry', () => {
  it('includes events inside the country and excludes those outside', () => {
    const events = [
      makeEvent('E_PARIS', { lng: 2.35, lat: 48.85 }),
      makeEvent('E_LYON', { lng: 4.83, lat: 45.76 }),
      makeEvent('E_LONDON', { lng: -0.12, lat: 51.5 }),
      makeEvent('E_NYC', { lng: -74.0, lat: 40.7 }),
    ];
    const inFrance = eventsInCountry(events, franceFeature);
    expect(inFrance.map((e) => e.id).sort()).toEqual(['E_LYON', 'E_PARIS']);
  });

  it('returns a new array and does not mutate the input', () => {
    const events = [makeEvent('E1', { lng: 2.35, lat: 48.85 })];
    const result = eventsInCountry(events, franceFeature);
    expect(result).not.toBe(events);
    expect(events.length).toBe(1);
  });

  it('returns an empty array when no events fall inside', () => {
    const events = [
      makeEvent('E_LONDON', { lng: -0.12, lat: 51.5 }),
      makeEvent('E_NYC', { lng: -74.0, lat: 40.7 }),
    ];
    expect(eventsInCountry(events, franceFeature)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// withinWindow
// ---------------------------------------------------------------------------

describe('withinWindow', () => {
  it('includes an event exactly at the inner edge (now - days + 1ms)', () => {
    const inside = new Date(NOW.getTime() - 7 * ONE_DAY_MS + 1);
    expect(withinWindow({ date: inside.toISOString() }, 7, NOW)).toBe(true);
  });

  it('includes an event dated exactly now', () => {
    expect(withinWindow({ date: NOW.toISOString() }, 7, NOW)).toBe(true);
  });

  it('excludes an event older than the window', () => {
    const tooOld = new Date(NOW.getTime() - 30 * ONE_DAY_MS);
    expect(withinWindow({ date: tooOld.toISOString() }, 7, NOW)).toBe(false);
  });

  it('excludes an event in the future beyond now', () => {
    const future = new Date(NOW.getTime() + ONE_DAY_MS);
    expect(withinWindow({ date: future.toISOString() }, 7, NOW)).toBe(false);
  });

  it('accepts a Date object as well as an ISO string', () => {
    const d = new Date(NOW.getTime() - 3 * ONE_DAY_MS);
    expect(withinWindow({ date: d }, 7, NOW)).toBe(true);
  });

  it('returns false for an unparseable date', () => {
    expect(withinWindow({ date: 'not-a-date' }, 7, NOW)).toBe(false);
  });

  it('respects the days parameter (14 vs 7)', () => {
    const d = new Date(NOW.getTime() - 10 * ONE_DAY_MS);
    expect(withinWindow({ date: d.toISOString() }, 7, NOW)).toBe(false);
    expect(withinWindow({ date: d.toISOString() }, 14, NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterEvents
// ---------------------------------------------------------------------------

describe('filterEvents', () => {
  const events = [
    makeEvent('E1', { status: 'open', categories: [{ id: 'wildfires', title: 'Wildfires' }] }),
    makeEvent('E2', { status: 'closed', categories: [{ id: 'wildfires', title: 'Wildfires' }] }),
    makeEvent('E3', { status: 'open', categories: [{ id: 'severeStorms', title: 'Severe Storms' }] }),
    makeEvent('E4', {
      status: 'open',
      categories: [
        { id: 'wildfires', title: 'Wildfires' },
        { id: 'severeStorms', title: 'Severe Storms' },
      ],
    }),
  ];

  it('returns all events when no filter is applied', () => {
    expect(filterEvents(events, {}).map((e) => e.id).sort()).toEqual(
      ['E1', 'E2', 'E3', 'E4'],
    );
  });

  it('treats "all" as no filter for both category and status', () => {
    expect(filterEvents(events, { category: 'all', status: 'all' }).length).toBe(4);
  });

  it('filters by category (matches events having that category id)', () => {
    const result = filterEvents(events, { category: 'wildfires' }).map((e) => e.id).sort();
    expect(result).toEqual(['E1', 'E2', 'E4']);
  });

  it('filters by status', () => {
    const result = filterEvents(events, { status: 'open' }).map((e) => e.id).sort();
    expect(result).toEqual(['E1', 'E3', 'E4']);
  });

  it('applies category + status as an intersection', () => {
    const result = filterEvents(events, {
      category: 'wildfires',
      status: 'open',
    }).map((e) => e.id).sort();
    expect(result).toEqual(['E1', 'E4']);
  });

  it('returns an empty array when no event matches', () => {
    expect(
      filterEvents(events, { category: 'volcanoes' }).map((e) => e.id),
    ).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const snapshot = [...events];
    filterEvents(events, { category: 'wildfires', status: 'open' });
    expect(events.map((e) => e.id)).toEqual(snapshot.map((e) => e.id));
  });
});

// ---------------------------------------------------------------------------
// categoryColor
// ---------------------------------------------------------------------------

describe('categoryColor', () => {
  it('returns a hex color for known EONET category slugs', () => {
    expect(categoryColor('wildfires')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(categoryColor('severeStorms')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(categoryColor('volcanoes')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('is deterministic: the same slug returns the same color', () => {
    expect(categoryColor('wildfires')).toBe(categoryColor('wildfires'));
  });

  it('returns distinct colors for distinct known categories', () => {
    const colors = new Set(
      knownCategorySlugs().map((slug) => categoryColor(slug)),
    );
    // Every known slug maps to a unique color (no two share one).
    expect(colors.size).toBe(knownCategorySlugs().length);
  });

  it('returns the neutral default for an unknown slug', () => {
    const unknown = categoryColor('doesNotExistSlug');
    expect(unknown).toMatch(/^#[0-9a-f]{6}$/i);
    expect(unknown).toBe(categoryColor('someOtherUnknownSlug'));
  });

  it('returns the neutral default for missing/empty input', () => {
    expect(categoryColor(undefined)).toBe(categoryColor(null));
    expect(categoryColor(undefined)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('never returns an empty string', () => {
    expect(categoryColor('wildfires').length).toBeGreaterThan(0);
    expect(categoryColor(undefined).length).toBeGreaterThan(0);
  });
});
