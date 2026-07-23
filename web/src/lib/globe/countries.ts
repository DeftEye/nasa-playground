import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Polygon,
  MultiPolygon,
} from 'geojson';
import type { CountryFeature } from './geo';

/**
 * Helpers for the bundled Natural Earth 110m admin-0 countries GeoJSON
 * (`web/public/countries.geojson`, served at `/countries.geojson`).
 *
 * Property keys (verified against the dataset, library/eonet-globe.md):
 * - Country name: `ADMIN` (e.g. "France"), fallback `NAME`.
 * - ISO / stable id: `ADM0_A3` (e.g. "FRA"). `ISO_A2`/`ISO_A3` are `-99` for
 *   some disputed entries, so `ADM0_A3` is the reliable id.
 */

const COUNTRIES_URL = '/countries.geojson';

/** Fetches and parses the bundled countries GeoJSON. Loaded once and reused
 *  for both globe rendering (`polygonsData`) and point-in-polygon
 *  hit-testing. Returns the raw `FeatureCollection` typed as country
 *  features. */
export async function fetchCountries(): Promise<
  FeatureCollection<Polygon | MultiPolygon, GeoJsonProperties>
> {
  const res = await fetch(COUNTRIES_URL);
  if (!res.ok) {
    throw new Error(`Failed to load countries.geojson: ${res.status}`);
  }
  return (await res.json()) as FeatureCollection<
    Polygon | MultiPolygon,
    GeoJsonProperties
  >;
}

/** Extracts the country name from a feature's properties (`ADMIN` ?? `NAME`). */
export function countryName(
  feature: Feature<Polygon | MultiPolygon, GeoJsonProperties>,
): string {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const admin = typeof props.ADMIN === 'string' ? props.ADMIN : undefined;
  const name = typeof props.NAME === 'string' ? props.NAME : undefined;
  return admin ?? name ?? 'Unknown';
}

/** Extracts the stable country id (`ADM0_A3`) from a feature's properties. */
export function countryId(
  feature: Feature<Polygon | MultiPolygon, GeoJsonProperties>,
): string {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const adm0a3 = typeof props.ADM0_A3 === 'string' ? props.ADM0_A3 : undefined;
  return adm0a3 ?? '';
}

/**
 * Finds a country feature by `ADM0_A3` (e.g. "FRA"). Returns `undefined`
 * when not found. Used by the `window.__selectCountry(adm0a3)` test hook.
 */
export function findCountryByAdm0A3(
  features: CountryFeature[],
  adm0a3: string,
): CountryFeature | undefined {
  return features.find((f) => countryId(f) === adm0a3);
}
