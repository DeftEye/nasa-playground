import { useEffect, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import type { CountryFeature } from '../../lib/globe/geo';
import { categoryColor } from '../../lib/globe/geo';
import { countryId } from '../../lib/globe/countries';
import type { EonetMapEvent } from '../../types';

/**
 * GlobeView — the react-globe.gl `<Globe>` wrapper (architecture §16.2 /
 * library/eonet-globe.md).
 *
 * Renders country polygons (Natural Earth 110m admin-0) as clickable
 * polygons and event points from the map endpoint colored by category, with
 * the event title on hover (`pointLabel`).
 *
 * This component pulls in three.js and MUST be lazy-loaded (the `/globe`
 * route is `React.lazy` + `Suspense` so three.js stays out of the initial
 * bundle — VAL-GLOBE-027).
 *
 * The parent only mounts this component when the synchronous WebGL guard
 * passes, and wraps it in `GlobeErrorBoundary` so a render-phase WebGL
 * failure is contained (VAL-GLOBE-022).
 */

/** Escapes HTML metacharacters so the hover tooltip text is XSS-safe even
 *  though react-globe.gl renders `pointLabel` as HTML internally. The DOM
 *  mirror renders titles as JSX text (no `dangerouslySetInnerHTML`). */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      (
        {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        } as Record<string, string>
      )[c] as string,
  );
}

export interface GlobeViewProps {
  countries: CountryFeature[];
  events: EonetMapEvent[];
  /** ADM0_A3 of the currently selected country, or undefined for none. */
  selectedAdm0a3?: string;
  /** Invoked when a country polygon is clicked (routed through the same
   *  `selectCountry` handler as the test hook — M11). */
  onPolygonClick?: (feature: CountryFeature) => void;
  /** Invoked when an event point is clicked. */
  onPointClick?: (event: EonetMapEvent) => void;
}

export function GlobeView({
  countries,
  events,
  selectedAdm0a3,
  onPolygonClick,
  onPointClick,
}: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 520 });

  // Track the container size so the canvas fills its wrapper. react-globe.gl
  // does not auto-size to a parent; it needs explicit width/height.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setSize({ width: w, height: h });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isSelected = (feature: CountryFeature): boolean =>
    !!selectedAdm0a3 && countryId(feature) === selectedAdm0a3;

  // react-globe.gl's `polygonGeoJsonGeometry` accessor expects its own
  // `GeoJsonGeometry` union, which does not match geojson's
  // `Polygon | MultiPolygon` typings. Cast to `any` to satisfy the prop
  // type; the runtime value is the feature's `geometry` (Polygon |
  // MultiPolygon), which react-globe.gl renders correctly.
  const polygonGeometryAccessor: any = (f: object) =>
    (f as CountryFeature).geometry;

  return (
    <div
      ref={containerRef}
      data-testid="globe-canvas-container"
      className="h-full w-full"
    >
      <Globe
        width={size.width}
        height={size.height}
        backgroundColor="rgba(0,0,0,0)"
        showGlobe
        showAtmosphere
        polygonsData={countries}
        polygonGeoJsonGeometry={polygonGeometryAccessor}
        polygonCapColor={(f) =>
          isSelected(f as CountryFeature)
            ? 'rgba(37, 99, 235, 0.75)'
            : 'rgba(148, 163, 184, 0.35)'
        }
        polygonSideColor={() => 'rgba(100, 116, 139, 0.15)'}
        polygonStrokeColor={() => 'rgba(71, 85, 105, 0.6)'}
        polygonAltitude={(f) => (isSelected(f as CountryFeature) ? 0.06 : 0.01)}
        onPolygonClick={(feat) => onPolygonClick?.(feat as CountryFeature)}
        pointsData={events}
        pointLat="lat"
        pointLng="lng"
        pointColor={(e) =>
          categoryColor((e as EonetMapEvent).categories?.[0]?.id)
        }
        pointAltitude={0.01}
        pointRadius={0.4}
        pointResolution={6}
        onPointClick={(e) => onPointClick?.(e as EonetMapEvent)}
        // Escape the title so react-globe.gl's HTML tooltip cannot inject
        // markup. Titles are also mirrored as JSX text in the DOM layer.
        pointLabel={(e) => escapeHtml((e as EonetMapEvent).title)}
      />
    </div>
  );
}
