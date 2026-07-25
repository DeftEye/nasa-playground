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
      className="card-cosmic mx-auto flex max-w-md flex-col items-center justify-center px-6 py-16 text-center"
      data-testid="error-state"
      role="alert"
    >
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-cosmic-error/40 bg-cosmic-error/10 text-3xl"
        aria-hidden="true"
      >
        ⚠️
      </div>
      <p className="font-display text-lg font-medium text-cosmic-error">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          data-testid={retryTestId}
          className="btn-primary mt-5"
        >
          Retry
        </button>
      )}
    </div>
  );
}
