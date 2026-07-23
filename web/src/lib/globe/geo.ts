import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { EonetMapEvent, EonetStatus } from '../../types';

/**
 * Pure, framework-free globe helpers (architecture §16.2 / VAL-COUNTRY-018,
 * VAL-GLOBE-007). These are the assertable core: point-in-polygon country
 * matching, date-window checks, client-side filtering, and category→color
 * mapping. No React, no DOM, no side effects — unit-tested directly.
 */

/** A GeoJSON country feature: either a `Polygon` or `MultiPolygon`. */
export type CountryFeature = Feature<Polygon | MultiPolygon>;

/** Anything with normalized `{lat, lng}` — covers `EonetMapEvent`. */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Returns `true` when the `[lng, lat]` point lies inside the country
 * polygon (or any polygon of a `MultiPolygon`). Wraps
 * `@turf/boolean-point-in-polygon`, which expects `[lng, lat]` order
 * (library/eonet-globe.md).
 *
 * Turf is correct on standard GeoJSON CCW Polygon/MultiPolygon; do NOT
 * substitute d3-geo (spherical-winding foot-gun).
 */
export function pointInCountry(
  lng: number,
  lat: number,
  feature: CountryFeature,
): boolean {
  return booleanPointInPolygon([lng, lat], feature);
}

/**
 * Filters `events` to those whose `{lat, lng}` falls inside `feature`.
 * Pure — returns a new array, does not mutate input.
 */
export function eventsInCountry<T extends LatLng>(
  events: T[],
  feature: CountryFeature,
): T[] {
  return events.filter((e) => pointInCountry(e.lng, e.lat, feature));
}

/**
 * Returns `true` when `event.date` (ISO string or Date) falls within
 * `[now - days, now]` inclusive. Used by client-side window filtering over
 * already-loaded events (e.g. side-panel re-derivation, VAL-COUNTRY-011).
 */
export function withinWindow(
  event: { date: string | Date },
  days: number,
  now: Date = new Date(),
): boolean {
  const d = event.date instanceof Date ? event.date : new Date(event.date);
  const t = d.getTime();
  if (!Number.isFinite(t)) {
    return false;
  }
  const to = now.getTime();
  const from = to - days * 24 * 60 * 60 * 1000;
  return t >= from && t <= to;
}

/** Active filter state for client-side event filtering. `category`/`status`
 *  use `'all'` (or `undefined`) to mean "no filter". */
export interface FilterEventsOptions {
  category?: string;
  status?: EonetStatus | 'all';
}

/**
 * Client-side category + status intersection filter over already-loaded map
 * events. Pure — returns a new array.
 *
 * `category` matches when the event has at least one category with that id.
 * `status` matches when the event's `status` equals it. Both applied as an
 * intersection (VAL-GLOBE-016).
 */
export function filterEvents(
  events: EonetMapEvent[],
  { category, status }: FilterEventsOptions,
): EonetMapEvent[] {
  const cat = category && category !== 'all' ? category : undefined;
  const st = status && status !== 'all' ? status : undefined;
  return events.filter((e) => {
    if (cat && !(e.categories ?? []).some((c) => c.id === cat)) {
      return false;
    }
    if (st && e.status !== st) {
      return false;
    }
    return true;
  });
}

/**
 * Stable, deterministic category→color mapping for plotted event points
 * (VAL-GLOBE-007). Known EONET category slugs map to a fixed palette;
 * unknown or missing slugs fall back to a neutral gray so every plotted
 * point has a non-empty color.
 */
const CATEGORY_COLORS: Record<string, string> = {
  severeStorms: '#ef4444', // red
  wildfires: '#f97316', // orange
  volcanoes: '#b91c1c', // dark red
  seaLakeIce: '#38bdf8', // sky
  snow: '#e5e7eb', // light gray
  drought: '#a16207', // brown
  dustHaze: '#d6a96b', // tan
  landslides: '#7c2d12', // earth
  manmade: '#6b7280', // gray
  waterColor: '#0ea5e9', // cyan
  extremeCold: '#93c5fd', // pale blue
  flooding: '#2563eb', // blue
  earthquakes: '#84cc16', // lime (not in EONET v3 but stable)
  tempExtremes: '#f59e0b', // amber
};

const DEFAULT_CATEGORY_COLOR = '#9ca3af'; // neutral gray

/** Returns the hex color for a category slug, or the neutral default. */
export function categoryColor(id?: string | null): string {
  if (!id) {
    return DEFAULT_CATEGORY_COLOR;
  }
  return CATEGORY_COLORS[id] ?? DEFAULT_CATEGORY_COLOR;
}

/** The set of category slugs with an explicit color (for tests/introspection). */
export function knownCategorySlugs(): string[] {
  return Object.keys(CATEGORY_COLORS);
}
