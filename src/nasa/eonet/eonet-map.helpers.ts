/**
 * Pure helpers for the EONET map endpoint (`GET /api/nasa/eonet/events/map`).
 *
 * These are framework-free and side-effect free so they can be unit-tested
 * directly. The service layer composes them into the full query + normalize
 * pipeline (architecture §16.1 / `library/eonet-globe.md`).
 */

/** A normalized map point: one representative `{lat, lng}` plus the
 *  observation date used for the date-window filter. */
export interface MapPoint {
  lat: number;
  lng: number;
  date: Date;
}

/** Normalizes a longitude to the range `[-180, 180]` (VAL-MAP-016). */
export function normalizeLng(lng: number): number {
  if (!Number.isFinite(lng)) {
    return NaN;
  }
  // Shift to [0, 360) then back to [-180, 180).
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Clamps a latitude to `[-90, 90]` (VAL-MAP-017). */
export function clampLat(lat: number): number {
  if (!Number.isFinite(lat)) {
    return NaN;
  }
  return Math.max(-90, Math.min(90, lat));
}

/**
 * Computes the date window `[now - days, now]` for the map endpoint. Pure and
 * deterministic given `now` so it is unit-testable.
 */
export function dateWindow(
  days: number,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const to = new Date(now.getTime());
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Parses an ISO date string (or Date) into a `Date`, or `null` if unusable. */
function parseDate(v: unknown): Date | null {
  if (v instanceof Date) {
    return Number.isFinite(v.getTime()) ? v : null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') {
    return null;
  }
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Arithmetic centroid of a GeoJSON ring (`[[lng, lat], ...]`). Drops a
 *  duplicated closing vertex so the mean is over the unique vertices. */
function ringCentroid(ring: unknown[]): { lng: number; lat: number } | null {
  if (!Array.isArray(ring) || ring.length === 0) {
    return null;
  }
  // Drop the closing duplicate if present (GeoJSON rings are closed).
  let pts = ring;
  if (
    pts.length >= 2 &&
    Array.isArray(pts[0]) &&
    Array.isArray(pts[pts.length - 1]) &&
    samePoint(pts[0] as number[], pts[pts.length - 1] as number[])
  ) {
    pts = pts.slice(0, -1);
  }
  if (pts.length === 0) {
    return null;
  }
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    if (!Array.isArray(p) || !isFiniteNumber(p[0]) || !isFiniteNumber(p[1])) {
      return null;
    }
    sx += p[0];
    sy += p[1];
  }
  return { lng: sx / pts.length, lat: sy / pts.length };
}

function samePoint(a: number[], b: number[]): boolean {
  return a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[1] === b[1];
}

/**
 * Derives a single `{lng, lat}` (un-normalized) from one EONET geometry
 * observation based on its `type`:
 * - `Point` → `coordinates = [lng, lat]` used directly.
 * - `Polygon` → centroid of the outer ring (`coordinates[0]`); inner rings
 *   (holes) are ignored.
 * - `MultiPolygon` → mean of the first ring of each polygon.
 * Returns `null` when no usable numeric coordinates are available.
 */
function observationPoint(obs: unknown): { lng: number; lat: number } | null {
  if (!obs || typeof obs !== 'object') {
    return null;
  }
  const o = obs as Record<string, unknown>;
  const type = o.type;
  const coordinates = o.coordinates;
  if (type === 'Point') {
    if (
      Array.isArray(coordinates) &&
      isFiniteNumber(coordinates[0]) &&
      isFiniteNumber(coordinates[1])
    ) {
      return { lng: coordinates[0], lat: coordinates[1] };
    }
    return null;
  }
  if (type === 'Polygon') {
    if (Array.isArray(coordinates) && coordinates.length > 0) {
      return ringCentroid(coordinates[0] as unknown[]);
    }
    return null;
  }
  if (type === 'MultiPolygon') {
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      return null;
    }
    const polys = coordinates as unknown[][];
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const poly of polys) {
      if (!Array.isArray(poly) || poly.length === 0) {
        continue;
      }
      const firstRing = poly[0] as unknown[];
      const c = ringCentroid(firstRing);
      if (!c) {
        continue;
      }
      sx += c.lng;
      sy += c.lat;
      n += 1;
    }
    if (n === 0) {
      return null;
    }
    return { lng: sx / n, lat: sy / n };
  }
  return null;
}

/**
 * Reduces an event's `geometry` JSONB array to ONE representative map point.
 *
 * Strategy (architecture §16.1):
 * 1. Among observations that have BOTH a usable date AND usable coords, pick
 *    the most-recent (max date). Use its date and coords.
 * 2. If no observation has a usable date, fall back to `firstSeenAt` for the
 *    date and use the first observation with usable coords for the point
 *    (VAL-MAP-008).
 * 3. If no observation yields usable numeric coordinates, return `null` (the
 *    event is excluded from the map payload — VAL-MAP-015).
 *
 * `lng` is normalized to `[-180, 180]` and `lat` is clamped to `[-90, 90]`.
 */
export function deriveMapPoint(
  geometry: unknown,
  firstSeenAt: Date | string,
): MapPoint | null {
  if (!Array.isArray(geometry) || geometry.length === 0) {
    return null;
  }

  const dated: Array<{ date: Date; point: { lng: number; lat: number } }> = [];
  const usable: Array<{ lng: number; lat: number }> = [];

  for (const obs of geometry) {
    const point = observationPoint(obs);
    if (point) {
      usable.push(point);
    }
    const d = parseDate((obs as Record<string, unknown>)?.date);
    if (d && point) {
      dated.push({ date: d, point });
    }
  }

  if (dated.length > 0) {
    dated.sort((a, b) => b.date.getTime() - a.date.getTime());
    const top = dated[0];
    return {
      lng: normalizeLng(top.point.lng),
      lat: clampLat(top.point.lat),
      date: top.date,
    };
  }

  if (usable.length > 0) {
    const fallbackDate = parseDate(firstSeenAt);
    if (!fallbackDate) {
      return null;
    }
    const p = usable[0];
    return {
      lng: normalizeLng(p.lng),
      lat: clampLat(p.lat),
      date: fallbackDate,
    };
  }

  return null;
}
