import type { CountryFeature } from './lib/globe/geo';

/**
 * Global test hook installed by the `/globe` page (architecture §16.2 /
 * library/eonet-globe.md / VAL-COUNTRY-015).
 *
 * `window.__selectCountry` routes through the SAME `selectCountry` handler
 * used by `onPolygonClick`, so validators can drive country selection
 * deterministically without a canvas hit-test. It accepts either a full
 * GeoJSON country feature or an `ADM0_A3` string (e.g. "FRA"); a string is
 * resolved against the currently loaded countries dataset.
 *
 * Installed on mount of `EonetGlobe`, removed on unmount. Typed as optional
 * so the page compiles even before the hook is attached.
 */
declare global {
  interface Window {
    __selectCountry?: (input: CountryFeature | string) => void;
  }
}

export {};
