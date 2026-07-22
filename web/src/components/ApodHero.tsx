import { useState } from 'react';
import type { ApodEntry } from '../types';

/**
 * ApodHero — renders a single APOD entry (today's picture on the Home page).
 *
 * Rendering policy (architecture §6 cross-page UX / security):
 * - `mediaType === 'video'` AND `videoUrl != null` → `<iframe>` to `videoUrl`.
 *   Otherwise → `<img>` to `url` (covers `image` and the rare `video` row
 *   with a non-YouTube source where the backend sets `videoUrl = null`).
 * - Long titles truncate with `truncate` (text-ellipsis, single row) so they
 *   never overflow the layout (VAL-FE-HOME-006).
 * - `explanation` and `copyright` are rendered as TEXT content via JSX curly
 *   braces — never `dangerouslySetInnerHTML`. A `<script>alert(1)</script>`
 *   payload renders as literal text and cannot execute
 *   (VAL-FE-HOME-005).
 * - Long explanations are collapsed by default with an expand/collapse
 *   affordance (VAL-FE-HOME-003).
 */

interface ApodHeroProps {
  entry: ApodEntry;
}

// Explanations longer than this many characters are collapsed by default
// behind an expand button (VAL-FE-HOME-003).
const EXPLANATION_COLLAPSE_THRESHOLD = 280;

export function ApodHero({ entry }: ApodHeroProps) {
  const [expanded, setExpanded] = useState(false);

  const isVideo = entry.mediaType === 'video' && entry.videoUrl !== null;
  const longExplanation =
    entry.explanation.length > EXPLANATION_COLLAPSE_THRESHOLD;

  const visibleExplanation =
    longExplanation && !expanded
      ? `${entry.explanation.slice(0, EXPLANATION_COLLAPSE_THRESHOLD).trimEnd()}…`
      : entry.explanation;

  return (
    <article className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {isVideo ? (
        <div className="aspect-video w-full bg-black">
          <iframe
            src={entry.videoUrl as string}
            title={entry.title}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            data-testid="apod-video-iframe"
          />
        </div>
      ) : (
        <div className="flex items-center justify-center bg-black">
          <img
            src={entry.url}
            alt={entry.title}
            className="max-h-[70vh] w-full object-contain"
            data-testid="apod-image"
          />
        </div>
      )}

      <div className="p-6">
        <div className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {entry.date}
          </p>
          {/* `truncate` keeps long titles on a single row with ellipsis
              instead of overflowing the viewport (VAL-FE-HOME-006). */}
          <h1
            className="truncate text-2xl font-bold text-gray-900 dark:text-gray-100"
            data-testid="apod-title"
            title={entry.title}
          >
            {entry.title}
          </h1>
          {entry.copyright && (
            <p className="truncate text-sm text-gray-500 dark:text-gray-400">
              © {entry.copyright}
            </p>
          )}
        </div>

        {/* Explanation: text content only — JSX curly braces guarantee the
            browser treats this as text, never HTML. A payload like
            `<script>alert(1)</script>` is displayed verbatim
            (VAL-FE-HOME-005). */}
        <div className="mt-4">
          <p
            className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300"
            data-testid="apod-explanation"
          >
            {visibleExplanation}
          </p>
          {longExplanation && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
              aria-expanded={expanded}
              data-testid="apod-explanation-toggle"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
