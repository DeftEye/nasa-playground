/**
 * Shared error-state component with a Retry button. Used by data-driven pages
 * when the primary query fails with a 5xx or network error (architecture §6
 * cross-page UX policy / VAL-FE-ERR-001/002/003).
 *
 * The `onRetry` callback re-runs the failed query (typically TanStack Query's
 * `refetch`).
 */

interface ErrorStateProps {
  /** Error message shown to the user. */
  message?: string;
  /** Called when the user clicks "Retry". */
  onRetry?: () => void;
  /** Optional `data-testid` for the Retry button (e.g. `globe-error-retry`)
   *  so page-specific validators can target it without ambiguity. */
  retryTestId?: string;
}

export function ErrorState({
  message = 'Something went wrong while loading data.',
  onRetry,
  retryTestId,
}: ErrorStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="error-state"
      role="alert"
    >
      <div className="mb-3 text-4xl">⚠️</div>
      <p className="text-lg font-medium text-red-600 dark:text-red-400">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          data-testid={retryTestId}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Retry
        </button>
      )}
    </div>
  );
}
