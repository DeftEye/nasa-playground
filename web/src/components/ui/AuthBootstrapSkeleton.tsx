import { Skeleton } from '../Skeleton';

/**
 * AuthBootstrapSkeleton — the shared cosmic loading-skeleton block rendered
 * by the auth-route wrappers (`RootRoute`, `ProtectedRoute`,
 * `PublicOnlyRoute`) while the `AuthProvider` is bootstrapping (validating
 * any stored token).
 *
 * Extracted from the previously duplicated inline block so the three
 * wrappers render identical markup. The rendered output, `data-testid`s,
 * and behavior are unchanged: a full-height centered deep-space panel
 * containing a 4-row shimmer `Skeleton`.
 */
export function AuthBootstrapSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-deep-space-base">
      <div className="w-full max-w-md p-8">
        <Skeleton rows={4} />
      </div>
    </div>
  );
}
