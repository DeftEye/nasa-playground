import {
  dateWindow,
  deriveMapPoint,
  normalizeLng,
  clampLat,
} from './eonet-map.helpers';

describe('eonet-map.helpers', () => {
  describe('normalizeLng', () => {
    it('passes through values already in [-180, 180]', () => {
      expect(normalizeLng(0)).toBe(0);
      expect(normalizeLng(123.456)).toBeCloseTo(123.456, 6);
      expect(normalizeLng(-45.1)).toBeCloseTo(-45.1, 6);
    });

    it('wraps 190 -> -170 (VAL-MAP-016)', () => {
      expect(normalizeLng(190)).toBeCloseTo(-170, 6);
    });

    it('wraps -200 -> 160 (VAL-MAP-016)', () => {
      expect(normalizeLng(-200)).toBeCloseTo(160, 6);
    });
  });

  describe('clampLat', () => {
    it('passes through values already in [-90, 90]', () => {
      expect(clampLat(0)).toBe(0);
      expect(clampLat(48.85)).toBeCloseTo(48.85, 6);
      expect(clampLat(-33.9)).toBeCloseTo(-33.9, 6);
    });

    it('clamps 95 -> 90 (VAL-MAP-017)', () => {
      expect(clampLat(95)).toBe(90);
    });

    it('clamps -95 -> -90 (VAL-MAP-017)', () => {
      expect(clampLat(-95)).toBe(-90);
    });
  });

  describe('dateWindow', () => {
    it('returns [now - days, now] bounds', () => {
      const now = new Date('2026-07-23T12:00:00.000Z');
      const w = dateWindow(7, now);
      expect(w.to.getTime()).toBe(now.getTime());
      expect(w.to.getTime() - w.from.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('supports 14 and 30 day windows', () => {
      const now = new Date('2026-07-23T12:00:00.000Z');
      expect(
        dateWindow(14, now).to.getTime() - dateWindow(14, now).from.getTime(),
      ).toBe(14 * 24 * 60 * 60 * 1000);
      expect(
        dateWindow(30, now).to.getTime() - dateWindow(30, now).from.getTime(),
      ).toBe(30 * 24 * 60 * 60 * 1000);
    });
  });

  describe('deriveMapPoint', () => {
    const firstSeenAt = new Date('2026-07-18T00:00:00.000Z');

    it('returns null for null geometry', () => {
      expect(deriveMapPoint(null, firstSeenAt)).toBeNull();
    });

    it('returns null for empty geometry array', () => {
      expect(deriveMapPoint([], firstSeenAt)).toBeNull();
    });

    it('returns null when no element yields usable numeric coords', () => {
      expect(
        deriveMapPoint(
          [
            { type: 'Point', coordinates: ['x', null] },
            { type: 'Point', coordinates: [] },
          ],
          firstSeenAt,
        ),
      ).toBeNull();
    });

    it('Point geometry passes coordinates through in [lng, lat] order (VAL-MAP-012)', () => {
      const mp = deriveMapPoint(
        [
          {
            date: '2026-07-20T00:00:00Z',
            type: 'Point',
            coordinates: [123.456, -45.67],
          },
        ],
        firstSeenAt,
      )!;
      expect(mp.lng).toBeCloseTo(123.456, 6);
      expect(mp.lat).toBeCloseTo(-45.67, 6);
      expect(mp.date.toISOString()).toBe('2026-07-20T00:00:00.000Z');
    });

    it('Polygon geometry is reduced to centroid of the outer ring (VAL-MAP-013)', () => {
      const mp = deriveMapPoint(
        [
          {
            date: '2026-07-20T00:00:00Z',
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
            ],
          },
        ],
        firstSeenAt,
      )!;
      expect(mp.lng).toBeCloseTo(5, 6);
      expect(mp.lat).toBeCloseTo(5, 6);
    });

    it('MultiPolygon geometry is reduced to mean of first ring of each polygon (VAL-MAP-014)', () => {
      // Polygon A first ring centroid (-10, 20); Polygon B first ring centroid (30, 40).
      // Mean = (10, 30) for (lng, lat).
      const mp = deriveMapPoint(
        [
          {
            date: '2026-07-20T00:00:00Z',
            type: 'MultiPolygon',
            coordinates: [
              [
                [
                  [-20, 10],
                  [0, 10],
                  [0, 30],
                  [-20, 30],
                  [-20, 10],
                ],
              ],
              [
                [
                  [20, 30],
                  [40, 30],
                  [40, 50],
                  [20, 50],
                  [20, 30],
                ],
              ],
            ],
          },
        ],
        firstSeenAt,
      )!;
      expect(mp.lng).toBeCloseTo(10, 6);
      expect(mp.lat).toBeCloseTo(30, 6);
    });

    it('MultiPolygon ignores inner rings/holes', () => {
      // Outer ring centroid (10, 10); inner ring centroid (5, 5) must be ignored.
      const mp = deriveMapPoint(
        [
          {
            date: '2026-07-20T00:00:00Z',
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [20, 0],
                [20, 20],
                [0, 20],
                [0, 0],
              ],
              [
                [2, 2],
                [8, 2],
                [8, 8],
                [2, 8],
                [2, 2],
              ],
            ],
          },
        ],
        firstSeenAt,
      )!;
      expect(mp.lng).toBeCloseTo(10, 6);
      expect(mp.lat).toBeCloseTo(10, 6);
    });

    it('picks the most-recent dated observation (VAL-MAP-007)', () => {
      const mp = deriveMapPoint(
        [
          {
            date: '2026-06-13T00:00:00Z', // now - 40 days
            type: 'Point',
            coordinates: [1, 2],
          },
          {
            date: '2026-07-18T00:00:00Z', // now - 5 days
            type: 'Point',
            coordinates: [3, 4],
          },
        ],
        firstSeenAt,
      )!;
      expect(mp.date.toISOString()).toBe('2026-07-18T00:00:00.000Z');
      expect(mp.lng).toBeCloseTo(3, 6);
      expect(mp.lat).toBeCloseTo(4, 6);
    });

    it('falls back to firstSeenAt when geometry observation has no date (VAL-MAP-008)', () => {
      const mp = deriveMapPoint(
        [
          {
            type: 'Point',
            coordinates: [2.35, 48.85],
          },
        ],
        firstSeenAt,
      )!;
      expect(mp.date.toISOString()).toBe('2026-07-18T00:00:00.000Z');
      expect(mp.lng).toBeCloseTo(2.35, 6);
      expect(mp.lat).toBeCloseTo(48.85, 6);
    });

    it('normalizes lng to [-180,180] and clamps lat to [-90,90]', () => {
      const mp = deriveMapPoint(
        [
          {
            date: '2026-07-20T00:00:00Z',
            type: 'Point',
            coordinates: [190.0, 95.0],
          },
        ],
        firstSeenAt,
      )!;
      expect(mp.lng).toBeCloseTo(-170, 6);
      expect(mp.lat).toBe(90);
    });

    it('excludes events where the only observation has no usable coords', () => {
      expect(
        deriveMapPoint(
          [{ date: '2026-07-20T00:00:00Z', type: 'Point', coordinates: [] }],
          firstSeenAt,
        ),
      ).toBeNull();
    });
  });
});
