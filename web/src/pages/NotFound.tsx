/**
 * NotFound — the catch-all 404 page component.
 *
 * Extracted from `App.tsx` so `App.tsx` only exports the router (clearing
 * the `react-refresh/only-export-components` lint warning). The rendered
 * 404 markup, `data-testid="not-found"`, and text are unchanged.
 */
export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-deep-space-base px-4 text-center text-star-white">
      <div
        className="card-cosmic mx-auto flex max-w-md flex-col items-center px-6 py-16"
        data-testid="not-found"
      >
        <div
          className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-nebula-purple/40 bg-deep-space-darker/60 text-3xl"
          aria-hidden="true"
        >
          🛰️
        </div>
        <h1 className="font-display text-2xl font-bold text-star-white">
          NASA Sky Tracker
        </h1>
        <p className="mt-2 text-muted">Page not found</p>
      </div>
    </div>
  );
}
