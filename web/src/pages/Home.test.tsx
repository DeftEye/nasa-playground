import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { Home } from './Home';
import { server } from '../test/server';
import type { ApodEntry } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IMAGE_ENTRY: ApodEntry = {
  date: '2025-07-22',
  title: 'The Andromeda Galaxy',
  explanation:
    "A spiral galaxy 2.5 million light-years away, the closest major galaxy to the Milky Way.",
  url: 'https://apod.nasa.gov/apod/image/2507/andromeda.jpg',
  mediaType: 'image',
  videoUrl: null,
  copyright: 'NASA',
  fetchedAt: '2025-07-22T16:00:00.000Z',
};

const VIDEO_ENTRY: ApodEntry = {
  date: '2025-07-22',
  title: 'Aurora over Norway',
  explanation: 'A time-lapse video of aurora borealis.',
  url: 'https://www.youtube.com/watch?v=abc123',
  mediaType: 'video',
  videoUrl: 'https://www.youtube.com/embed/abc123',
  copyright: null,
  fetchedAt: '2025-07-22T16:00:00.000Z',
};

// A video APOD whose source host has no supported embed (e.g. a direct
// `.mp4` file page). The backend leaves `videoUrl = null` and keeps `url`
// pointing at the source video page (VAL-APOD-010). The UI must NOT render
// an `<img>` whose src is that video-page url (broken image) — instead it
// must render a "Watch video" link to `url` (VAL-FE-HOME-008).
const VIDEO_NO_EMBED_ENTRY: ApodEntry = {
  date: '2025-07-22',
  title: 'Direct File Video',
  explanation: 'A direct-file video with no embeddable player.',
  url: 'https://example.com/videos/aurora.mp4',
  mediaType: 'video',
  videoUrl: null,
  copyright: null,
  fetchedAt: '2025-07-22T16:00:00.000Z',
};

const LONG_TITLE =
  'A Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Very Long APOD Title That Should Truncate With Ellipsis';

const LONG_EXPLANATION_ENTRY: ApodEntry = {
  ...IMAGE_ENTRY,
  title: 'Long Explanation Entry',
  explanation:
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20),
};

const XSS_ENTRY: ApodEntry = {
  ...IMAGE_ENTRY,
  title: 'XSS Safety',
  explanation:
    '<script>alert(1)</script> and <img src=x onerror=alert(1)> should render as text.',
};

function todayHandler(entry: ApodEntry = IMAGE_ENTRY) {
  return http.get('/api/nasa/apod/today', () =>
    HttpResponse.json(entry, { status: 200 }),
  );
}

function today404Handler() {
  return http.get('/api/nasa/apod/today', () =>
    HttpResponse.json({ message: 'Not found' }, { status: 404 }),
  );
}

function today500Handler() {
  return http.get('/api/nasa/apod/today', () =>
    HttpResponse.json({ message: 'Internal error' }, { status: 500 }),
  );
}

function todayDelayedHandler(entry: ApodEntry = IMAGE_ENTRY, ms = 500) {
  return http.get('/api/nasa/apod/today', async () => {
    await delay(ms);
    return HttpResponse.json(entry, { status: 200 });
  });
}

function triggerFetchHandler(entry: ApodEntry = IMAGE_ENTRY) {
  return http.post('/api/nasa/triggers/fetch-apod', () =>
    HttpResponse.json(entry, { status: 200 }),
  );
}

function HomeTree() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<div>Login page</div>} />
    </Routes>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// VAL-FE-HOME-001: renders today's APOD title and image
// ---------------------------------------------------------------------------

describe('Home — VAL-FE-HOME-001 title and image', () => {
  it('renders the APOD title and an <img> with the entry url', async () => {
    server.use(todayHandler());

    renderWithProviders(<HomeTree />, {
      routerProps: { initialEntries: ['/'] },
    });

    expect(await screen.findByTestId('apod-title')).toHaveTextContent(
      IMAGE_ENTRY.title,
    );
    const img = await screen.findByTestId('apod-image');
    expect(img).toHaveAttribute('src', IMAGE_ENTRY.url);
    expect(screen.queryByTestId('apod-video-iframe')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-HOME-002: video entries render an <iframe>; image entries render <img>
// ---------------------------------------------------------------------------

describe('Home — VAL-FE-HOME-002 video vs image', () => {
  it('renders an <iframe> for video entries with non-null videoUrl', async () => {
    server.use(todayHandler(VIDEO_ENTRY));

    renderWithProviders(<HomeTree />, {
      routerProps: { initialEntries: ['/'] },
    });

    const iframe = await screen.findByTestId('apod-video-iframe');
    expect(iframe).toHaveAttribute('src', VIDEO_ENTRY.videoUrl);
    expect(screen.queryByTestId('apod-image')).not.toBeInTheDocument();
  });

  it('renders an <img> when mediaType is image', async () => {
    server.use(todayHandler());

    renderWithProviders(<HomeTree />, {
      routerProps: { initialEntries: ['/'] },
    });

    const img = await screen.findByTestId('apod-image');
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', IMAGE_ENTRY.url);
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-HOME-008: video with no embeddable videoUrl renders a "Watch video"
// link to the source url (new tab), never a broken <img> with the video url.
// ---------------------------------------------------------------------------

describe('Home — VAL-FE-HOME-008 video with null videoUrl', () => {
  it('renders a "Watch video" link to entry.url and no <img> with the video url', async () => {
    server.use(todayHandler(VIDEO_NO_EMBED_ENTRY));

    renderWithProviders(<HomeTree />, {
      routerProps: { initialEntries: ['/'] },
    });

    // Wait for the hero to render.
    await screen.findByTestId('apod-title');

    // A visible "Watch video" affordance links to the source video url.
    const watchLink = await screen.findByRole('link', { name: /watch video/i });
    expect(watchLink).toBeVisible();
    expect(watchLink).toHaveAttribute('href', VIDEO_NO_EMBED_ENTRY.url);
    // Opens in a new tab without leaking a reference to the opener.
    expect(watchLink).toHaveAttribute('target', '_blank');
    expect(watchLink.getAttribute('rel')).toMatch(/noopener/);
    expect(watchLink.getAttribute('rel')).toMatch(/noreferrer/);

    // No <iframe> is rendered for a non-embeddable video.
    expect(screen.queryByTestId('apod-video-iframe')).not.toBeInTheDocument();

    // No <img> whose src is the video-page url exists (would be a broken
    // image). The image testid must be absent, and no stray <img> points at
    // the video url either.
    expect(screen.queryByTestId('apod-image')).not.toBeInTheDocument();
    const imgs = document.querySelectorAll('img');
    imgs.forEach((img) => {
      expect(img).not.toHaveAttribute('src', VIDEO_NO_EMBED_ENTRY.url);
    });
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-HOME-003: long explanation collapsed by default, expands on click
// ---------------------------------------------------------------------------

describe('Home — VAL-FE-HOME-003 expandable explanation', () => {
  it('shows a truncated explanation and a toggle; expands on click', async () => {
    const user = userEvent.setup();
    server.use(todayHandler(LONG_EXPLANATION_ENTRY));

    renderWithProviders(<HomeTree />, {
      routerProps: { initialEntries: ['/'] },
    });

    const explanation = await screen.findByTestId('apod-explanation');
    // Collapsed by default: text ends with the ellipsis we append.
    expect(explanation.textContent).toMatch(/…$/);
    expect(explanation.textContent).not.toBe(LONG_EXPLANATION_ENTRY.explanation);

    const toggle = await screen.findByTestId('apod-explanation-toggle');
    expect(toggle).toHaveTextContent('Show more');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    await waitFor(() => {
      expect(screen.getByTestId('apod-explanation').textContent).toBe(
        LONG_EXPLANATION_ENTRY.explanation,
      );
    });
    expect(screen.getByTestId('apod-explanation-toggle')).toHaveTextContent(
      'Show less',
    );
    expect(screen.getByTestId('apod-explanation-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-HOME-004: loading skeleton while the fetch is delayed
// ---------------------------------------------------------------------------

describe('Home — VAL-FE-HOME-004 loading skeleton', () => {
  it('renders a skeleton while the APOD fetch is pending', async () => {
    server.use(todayDelayedHandler(IMAGE_ENTRY, 500));

    renderWithProviders(<HomeTree />, {
      routerProps: { initialEntries: ['/'] },
    });

    expect(await screen.findByTestId('home-skeleton')).toBeInTheDocument();

    // After the delayed response resolves, the hero renders.
    await waitFor(() => {
      expect(screen.getByTestId('apod-title')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('home-skeleton')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-HOME-005: XSS-safe explanation rendering
// ---------------------------------------------------------------------------

describe('Home — VAL-FE-HOME-005 XSS safety', () => {
  it('renders the script tag as literal text and does not execute it', async () => {
    server.use(todayHandler(XSS_ENTRY));

    renderWithProviders(<HomeTree />, {
      routerProps: { initialEntries: ['/'] },
    });

    const explanation = await screen.findByTestId('apod-explanation');
    // The literal script tag must appear as TEXT, not as a live element.
    expect(explanation.textContent).toContain('<script>alert(1)</script>');
    expect(explanation.textContent).toContain(
      '<img src=x onerror=alert(1)>',
    );
    // No live <script> or <img> element is injected as a child of the
    // explanation node — the payload is rendered as text only.
    expect(explanation.querySelector('script')).toBeNull();
    expect(explanation.querySelector('img')).toBeNull();
    // The explanation node itself is a <p> (text container), not a script.
    expect(explanation.tagName).toBe('P');
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-HOME-006: long title truncates without overflowing layout
// ---------------------------------------------------------------------------

describe('Home — VAL-FE-HOME-006 long title truncation', () => {
  it('applies the truncate utility class to a long title', async () => {
    server.use(todayHandler({ ...IMAGE_ENTRY, title: LONG_TITLE }));

    renderWithProviders(<HomeTree />, {
      routerProps: { initialEntries: ['/'] },
    });

    const title = await screen.findByTestId('apod-title');
    expect(title).toHaveTextContent(LONG_TITLE);
    // Tailwind `truncate` => `overflow-hidden text-ellipsis whitespace-nowrap`.
    expect(title.className).toMatch(/truncate/);
    // The full text is available via the title attribute for hover/tooltips.
    expect(title).toHaveAttribute('title', LONG_TITLE);
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-HOME-007: empty state with manual trigger button when no row for today
// ---------------------------------------------------------------------------

describe('Home — VAL-FE-HOME-007 empty state', () => {
  it('shows the empty state with a manual trigger button on 404', async () => {
    server.use(today404Handler(), triggerFetchHandler());

    renderWithProviders(<HomeTree />, {
      routerProps: { initialEntries: ['/'] },
    });

    const empty = await screen.findByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'zero');
    expect(empty).toHaveTextContent("Today's picture hasn't been fetched yet");
    const trigger = within(empty).getByTestId('home-trigger-fetch');
    expect(trigger).toBeInTheDocument();
  });

  it('clicking the trigger button POSTs /api/nasa/triggers/fetch-apod and refetches', async () => {
    const user = userEvent.setup();
    let triggerCount = 0;
    let todayCallCount = 0;
    server.use(
      http.get('/api/nasa/apod/today', () => {
        todayCallCount += 1;
        // First call: 404 (no row). Subsequent calls: return the entry.
        if (todayCallCount === 1) {
          return HttpResponse.json({ message: 'Not found' }, { status: 404 });
        }
        return HttpResponse.json(IMAGE_ENTRY, { status: 200 });
      }),
      http.post('/api/nasa/triggers/fetch-apod', () => {
        triggerCount += 1;
        return HttpResponse.json(IMAGE_ENTRY, { status: 200 });
      }),
    );

    renderWithProviders(<HomeTree />, {
      routerProps: { initialEntries: ['/'] },
    });

    const trigger = await screen.findByTestId('home-trigger-fetch');
    await user.click(trigger);

    // Trigger fired, then today refetched and the hero rendered.
    await waitFor(() => {
      expect(triggerCount).toBe(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('apod-title')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-ERR-001: 5xx error with Retry button
// ---------------------------------------------------------------------------

describe('Home — VAL-FE-ERR-001 5xx error and retry', () => {
  it('renders an inline error with a Retry button on 500', async () => {
    server.use(today500Handler());

    renderWithProviders(<HomeTree />, {
      routerProps: { initialEntries: ['/'] },
    });

    const errorState = await screen.findByTestId('error-state');
    expect(errorState).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('clicking Retry re-runs the query', async () => {
    const user = userEvent.setup();
    let callCount = 0;
    server.use(
      http.get('/api/nasa/apod/today', () => {
        callCount += 1;
        if (callCount === 1) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json(IMAGE_ENTRY, { status: 200 });
      }),
    );

    renderWithProviders(<HomeTree />, {
      routerProps: { initialEntries: ['/'] },
    });

    const retry = await screen.findByRole('button', { name: /retry/i });
    await user.click(retry);

    await waitFor(() => {
      expect(screen.getByTestId('apod-title')).toBeInTheDocument();
    });
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});
