/**
 * Shared empty-state component. Used by data-driven pages to communicate "no
 * data yet" or "filter matches nothing" (architecture §6 cross-page UX policy).
 *
 * The `variant` prop distinguishes the two cases with distinct copy:
 * - `zero` — zero data exists at all ("No data yet").
 * - `filtered` — data exists but the current filter matches nothing.
 */

interface EmptyStateProps {
  /** Message shown to the user. */
  message: string;
  /** Optional secondary description. */
  description?: string;
  /** Optional call-to-action element (e.g. a button). */
  action?: React.ReactNode;
  /** Which kind of empty state: zero-total vs. filtered-empty. */
  variant?: 'zero' | 'filtered';
}

export function EmptyState({
  message,
  description,
  action,
  variant = 'zero',
}: EmptyStateProps) {
  return (
    <div
      className="card-cosmic mx-auto flex max-w-md flex-col items-center justify-center px-6 py-16 text-center"
      data-testid="empty-state"
      data-variant={variant}
    >
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-nebula-purple/40 bg-deep-space-darker/60 text-3xl"
        aria-hidden="true"
      >
        {variant === 'zero' ? '📭' : '🔍'}
      </div>
      <p className="font-display text-lg font-medium text-star-white">
        {message}
      </p>
      {description && (
        <p className="mt-2 text-sm text-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
