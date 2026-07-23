/**
 * Synchronous WebGL-availability probe (architecture §16.2 /
 * library/eonet-globe.md / VAL-GLOBE-022).
 *
 * Before mounting `<Globe>` (which pulls in three.js), we synchronously try
 * to acquire a WebGL2 (fallback WebGL) context from a throwaway canvas. If
 * either is available, the globe canvas is mounted; otherwise we render the
 * `globe-webgl-unavailable` fallback AND still render the full DOM mirror
 * layer (filters + events count + event points) so the page stays testable
 * without WebGL (VAL-GLOBE-023).
 *
 * The probe is intentionally synchronous so the first render already decides
 * whether to mount the canvas — no flash of canvas-then-fallback.
 */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    return !!gl;
  } catch {
    return false;
  }
}
