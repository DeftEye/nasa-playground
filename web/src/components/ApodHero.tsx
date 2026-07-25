import { useState } from 'react';
import type { ApodEntry } from '../types';

/**
 * ApodHero — renders a single APOD entry (today's picture on the Home page).
 *
 * Rendering policy (architecture §6 cross-page UX / security):
 * - `mediaType === 'video'` AND `videoUrl != null` → `<iframe>` to `videoUrl`
 *   (YouTube or Vimeo embed).
 * - `mediaType === 'video'` AND `videoUrl == null` → a clickable "Watch
 *   video" affordance linking to the source `url` (opens in a new tab,
 *   `rel=noopener noreferrer`). A non-embeddable video host must NEVER be
 *   rendered as an `<img>` whose `src` is the video page (broken image)
 *   (VAL-FE-HOME-008).
 * - `mediaType === 'image'` (or any non-video) → `<img>` to `url`.
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

  const isVideo = entry.mediaType === 'video';
  const hasEmbed = entry.videoUrl !== null;
  const longExplanation =
    entry.explanation.length > EXPLANATION_COLLAPSE_THRESHOLD;

  const visibleExplanation =
    longExplanation && !expanded
      ? `${entry.explanation.slice(0, EXPLANATION_COLLAPSE_THRESHOLD).trimEnd()}…`
      : entry.explanation;

  return (
    <article className="card-cosmic overflow-hidden">
      {isVideo && hasEmbed ? (
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
      ) : isVideo && !hasEmbed ? (
        // Non-embeddable video (e.g. a direct `.mp4` file page): render a
        // clear "Watch video" affordance to the source `url` instead of an
        // `<img>` whose src is a video page (which would be a broken image).
        // Opens in a new tab with `rel=noopener noreferrer` (VAL-FE-HOME-008).
        <div className="flex aspect-video w-full items-center justify-center bg-deep-space-darker">
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
            data-testid="apod-video-watch-link"
          >
            <span aria-hidden="true">▶</span> Watch video
          </a>
        </div>
      ) : (
        <div className="flex items-center justify-center bg-deep-space-darker">
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
          <p className="text-xs uppercase tracking-wide text-muted">
            {entry.date}
          </p>
          {/* `truncate` keeps long titles on a single row with ellipsis
              instead of overflowing the viewport (VAL-FE-HOME-006). */}
          <h1
            className="truncate text-2xl font-bold text-star-white"
            data-testid="apod-title"
            title={entry.title}
          >
            {entry.title}
          </h1>
          {entry.copyright && (
            <p className="truncate text-sm text-muted">
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
            className="whitespace-pre-wrap text-sm leading-relaxed text-star-white/80"
            data-testid="apod-explanation"
          >
            {visibleExplanation}
          </p>
          {longExplanation && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-sm font-medium text-nebula-purple-soft transition-colors hover:text-star-white focus:outline-none focus-visible:ring-2 focus-visible:ring-nebula-purple-soft"
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
