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
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="empty-state"
      data-variant={variant}
    >
      <div className="mb-3 text-4xl">
        {variant === 'zero' ? '📭' : '🔍'}
      </div>
      <p className="text-lg font-medium text-gray-700 dark:text-gray-200">
        {message}
      </p>
      {description && (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
