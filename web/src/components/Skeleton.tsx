/**
 * Shared loading skeleton component. Used by every data-driven page while its
 * primary query is pending (architecture §6 cross-page UX policy).
 *
 * Renders a configurable number of shimmer placeholder rows.
 */

interface SkeletonProps {
  /** Number of placeholder rows to render. Default: 3. */
  rows?: number;
  /** Extra CSS classes on the wrapper. */
  className?: string;
}

export function Skeleton({ rows = 3, className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse space-y-3 ${className}`}
      role="status"
      aria-label="Loading"
      data-testid="skeleton"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-4 w-full rounded bg-gray-200 dark:bg-gray-700"
        />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
