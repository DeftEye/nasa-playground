import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay, type JsonBodyType } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { ApodArchive } from './ApodArchive';
import { server } from '../test/server';
import { AUTH_TOKEN_KEY } from '../api/client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

function makeEntry(i: number, overrides: Partial<Record<string, unknown>> = {}) {
  // Generate dates in DESC order so page 1 has the newest.
  const date = `2025-07-${String(25 - i).padStart(2, '0')}`;
  return {
    date,
    title: `APOD #${i + 1}`,
    explanation: 'Explanation.',
    url: `https://apod.nasa.gov/apod/image/2507/pic${i}.jpg`,
    mediaType: 'image',
    videoUrl: null,
    copyright: null,
    fetchedAt: '2025-07-22T16:00:00.000Z',
    ...overrides,
  };
}

function makeList(total: number, page: number, limit = PAGE_SIZE) {
  const start = (page - 1) * limit;
  const end = Math.min(start + limit, total);
  const data: ReturnType<typeof makeEntry>[] = [];
  for (let i = start; i < end; i += 1) {
    data.push(makeEntry(i));
  }
  return { data, total, page, limit };
}

function listHandler(total: number) {
  return http.get('/api/nasa/apod', ({ request }) => {
    const url = new URL(request.url);
    const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1;
    const limit =
      Number.parseInt(url.searchParams.get('limit') ?? String(PAGE_SIZE), 10) ||
      PAGE_SIZE;
    return HttpResponse.json(makeList(total, page, limit), { status: 200 });
  });
}

function emptyListHandler() {
  return http.get('/api/nasa/apod', () =>
    HttpResponse.json(
      { data: [], total: 0, page: 1, limit: PAGE_SIZE },
      { status: 200 },
    ),
  );
}

function errorListHandler() {
  return http.get('/api/nasa/apod', () =>
    HttpResponse.json({ message: 'boom' }, { status: 500 }),
  );
}

function delayedListHandler(total: number, ms = 500) {
  return http.get('/api/nasa/apod', async ({ request }) => {
    await delay(ms);
    const url = new URL(request.url);
    const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1;
    const limit =
      Number.parseInt(url.searchParams.get('limit') ?? String(PAGE_SIZE), 10) ||
      PAGE_SIZE;
    return HttpResponse.json(makeList(total, page, limit), { status: 200 });
  });
}

function videoListHandler() {
  const data = [
    {
      date: '2025-07-22',
      title: 'Video APOD',
      explanation: 'A video.',
      url: 'https://www.youtube.com/watch?v=abc123',
      mediaType: 'video',
      videoUrl: 'https://www.youtube.com/embed/abc123',
      copyright: null,
      fetchedAt: '2025-07-22T16:00:00.000Z',
    },
  ];
  return http.get('/api/nasa/apod', ({ request }) => {
    const url = new URL(request.url);
    const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1;
    return HttpResponse.json(
      { data, total: 1, page, limit: PAGE_SIZE },
      { status: 200 },
    );
  });
}

// A video APOD whose source host has no supported embed (e.g. a direct
// `.mp4` file page). Backend leaves `videoUrl = null` and keeps `url`
// pointing at the source video page (VAL-APOD-010). The archive card must
// NOT render an `<img>` whose src is the video-page url (broken image) —
// instead it must render a "Watch video" link to `url`
// (VAL-FE-ARCHIVE-006).
function videoNoEmbedListHandler() {
  const data = [
    {
      date: '2025-07-22',
      title: 'Direct File Video',
      explanation: 'A direct-file video with no embeddable player.',
      url: 'https://example.com/videos/aurora.mp4',
      mediaType: 'video',
      videoUrl: null,
      copyright: null,
      fetchedAt: '2025-07-22T16:00:00.000Z',
    },
  ];
  return http.get('/api/nasa/apod', ({ request }) => {
    const url = new URL(request.url);
    const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1;
    return HttpResponse.json(
      { data, total: 1, page, limit: PAGE_SIZE },
      { status: 200 },
    );
  });
}

function ArchiveTree() {
  return (
    <Routes>
      <Route path="/apod/archive" element={<ApodArchive />} />
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
// VAL-FE-ARCHIVE-001: paginated grid with date + title per card
// ---------------------------------------------------------------------------

describe('ApodArchive — VAL-FE-ARCHIVE-001 paginated grid', () => {
  it('renders a grid of cards with date and title', async () => {
    server.use(listHandler(5));

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    const cards = await screen.findAllByTestId('apod-archive-card');
    expect(cards).toHaveLength(5);
    expect(cards[0]).toHaveTextContent('2025-07-25');
    expect(cards[0]).toHaveTextContent('APOD #1');
  });

  it('requests page=1 and limit=20 by default', async () => {
    let requestedUrl = '';
    server.use(
      http.get('/api/nasa/apod', ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json(makeList(25, 1), { status: 200 });
      }),
    );

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    await screen.findAllByTestId('apod-archive-card');
    const url = new URL(requestedUrl);
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('limit')).toBe('20');
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-ARCHIVE-002: Prev/Next, URL reflects page state, deep-link
// ---------------------------------------------------------------------------

describe('ApodArchive — VAL-FE-ARCHIVE-002 pagination + URL state', () => {
  it('Next moves to page 2 (different cards) and Prev returns to page 1', async () => {
    const user = userEvent.setup();
    const requestedPages: number[] = [];
    server.use(
      http.get('/api/nasa/apod', ({ request }) => {
        const url = new URL(request.url);
        const page =
          Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1;
        requestedPages.push(page);
        return HttpResponse.json(makeList(25, page), { status: 200 });
      }),
    );

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    // Wait for page 1.
    const cards1 = await screen.findAllByTestId('apod-archive-card');
    expect(cards1).toHaveLength(20);
    expect(requestedPages[0]).toBe(1);

    const next = screen.getByTestId('archive-next');
    await user.click(next);

    // Page 2 request fired and cards are different (different dates).
    await waitFor(() => {
      expect(requestedPages).toContain(2);
    });
    const cards2 = await screen.findAllByTestId('apod-archive-card');
    expect(cards2).toHaveLength(5);
    // Page 2 = entries index 20..24 → days 5..1, title APOD #21.
    expect(cards2[0]).toHaveTextContent('2025-07-05');
    expect(cards2[0]).toHaveTextContent('APOD #21');

    // Prev returns to page 1.
    const prev = screen.getByTestId('archive-prev');
    await user.click(prev);
    const cards1Again = await screen.findAllByTestId('apod-archive-card');
    expect(cards1Again).toHaveLength(20);
  });

  it('deep-link to /apod/archive?page=2 loads page 2 on mount', async () => {
    server.use(listHandler(25));

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive?page=2'] },
    });

    const cards = await screen.findAllByTestId('apod-archive-card');
    expect(cards).toHaveLength(5);
    // Page 2 = entries index 20..24 → days 5..1, title APOD #21.
    expect(cards[0]).toHaveTextContent('2025-07-05');
    expect(cards[0]).toHaveTextContent('APOD #21');
  });

  it('Prev is disabled on page 1; Next is disabled on the last page', async () => {
    server.use(listHandler(5));

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    await screen.findAllByTestId('apod-archive-card');
    expect(screen.getByTestId('archive-prev')).toBeDisabled();
    expect(screen.getByTestId('archive-next')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-ARCHIVE-003: empty archive shows empty state, no pagination
// ---------------------------------------------------------------------------

describe('ApodArchive — VAL-FE-ARCHIVE-003 empty state', () => {
  it('shows an empty state with no pagination when total is 0', async () => {
    server.use(emptyListHandler());

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    const empty = await screen.findByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'zero');
    expect(screen.queryByTestId('archive-pagination')).not.toBeInTheDocument();
    expect(screen.queryByTestId('apod-archive-card')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-ARCHIVE-004: video entries render an <iframe> thumbnail
// ---------------------------------------------------------------------------

describe('ApodArchive — VAL-FE-ARCHIVE-004 video iframe', () => {
  it('renders an <iframe> for a video entry instead of an <img>', async () => {
    server.use(videoListHandler());

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    const card = await screen.findByTestId('apod-archive-card');
    const iframe = within(card).getByTestId('apod-archive-card-iframe');
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe).toHaveAttribute('src', 'https://www.youtube.com/embed/abc123');
    expect(
      within(card).queryByTestId('apod-archive-card-image'),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-ARCHIVE-006: video with null videoUrl renders a "Watch video" link,
// never a broken <img> with the video-page url as src.
// ---------------------------------------------------------------------------

describe('ApodArchive — VAL-FE-ARCHIVE-006 video with null videoUrl', () => {
  it('renders a "Watch video" link to entry.url and no <img> with the video url', async () => {
    server.use(videoNoEmbedListHandler());

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    const card = await screen.findByTestId('apod-archive-card');

    // A visible "Watch video" affordance links to the source video url.
    const watchLink = within(card).getByRole('link', { name: /watch video/i });
    expect(watchLink).toBeVisible();
    expect(watchLink).toHaveAttribute('href', 'https://example.com/videos/aurora.mp4');
    // Opens in a new tab without leaking a reference to the opener.
    expect(watchLink).toHaveAttribute('target', '_blank');
    expect(watchLink.getAttribute('rel')).toMatch(/noopener/);
    expect(watchLink.getAttribute('rel')).toMatch(/noreferrer/);

    // No <iframe> is rendered for a non-embeddable video.
    expect(
      within(card).queryByTestId('apod-archive-card-iframe'),
    ).not.toBeInTheDocument();

    // No <img> whose src is the video-page url exists on the card (would be
    // a broken image). The image testid must be absent, and no stray <img>
    // on the card points at the video url either.
    expect(
      within(card).queryByTestId('apod-archive-card-image'),
    ).not.toBeInTheDocument();
    const imgs = card.querySelectorAll('img');
    imgs.forEach((img) => {
      expect(img).not.toHaveAttribute(
        'src',
        'https://example.com/videos/aurora.mp4',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-ARCHIVE-005: loading skeleton shown until data populates
// ---------------------------------------------------------------------------

describe('ApodArchive — VAL-FE-ARCHIVE-005 loading skeleton', () => {
  it('renders a skeleton while the list is pending, then the grid', async () => {
    server.use(delayedListHandler(5, 500));

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    expect(await screen.findByTestId('archive-skeleton')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByTestId('apod-archive-card').length).toBeGreaterThan(
        0,
      );
    });
    expect(screen.queryByTestId('archive-skeleton')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Extra: 5xx error state with Retry (cross-page UX policy)
// ---------------------------------------------------------------------------

describe('ApodArchive — 5xx error and retry', () => {
  it('renders an inline error with Retry on 500', async () => {
    server.use(errorListHandler());

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    const errorState = await screen.findByTestId('error-state');
    expect(errorState).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-PRODFIX-007: UI backfill control populates and refreshes history
// ---------------------------------------------------------------------------
//
// The Archive page exposes a "Backfill 30 days" control
// (`apod-backfill-button`) that POSTs to both backfill trigger endpoints
// with the auth header, disables itself while in-flight, shows a status
// message (`apod-backfill-status`), and on success invalidates the archive
// react-query cache so the list refetches and shows the newly backfilled
// entries.

const TOKEN = 'test-jwt-token';
const ME = {
  id: 'u-1',
  email: 'tester@example.com',
  createdAt: '2025-07-22T10:00:00.000Z',
};

function authMeHandler() {
  return http.get('/api/auth/me', ({ request }) => {
    // Echo the bearer so tests can confirm the bootstrap call is authed too.
    const auth = request.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer ')) {
      return HttpResponse.json({ message: 'unauthorized' }, { status: 401 });
    }
    return HttpResponse.json(ME, { status: 200 });
  });
}

interface CapturedRequest {
  url: string;
  auth: string | null;
  body: unknown;
}

function backfillApodHandler(
  captured: CapturedRequest[] = [],
  response: JsonBodyType | (() => JsonBodyType) = [],
  status = 200,
  delayMs = 0,
) {
  return http.post('/api/nasa/triggers/backfill-apod', async ({ request }) => {
    captured.push({
      url: request.url,
      auth: request.headers.get('authorization'),
      body: null,
    });
    const body = typeof response === 'function' ? response() : response;
    if (delayMs > 0) await delay(delayMs);
    return HttpResponse.json(body, { status });
  });
}

function backfillEonetHandler(
  captured: CapturedRequest[] = [],
  status = 200,
  delayMs = 0,
) {
  return http.post('/api/nasa/triggers/backfill-eonet', async ({ request }) => {
    captured.push({
      url: request.url,
      auth: request.headers.get('authorization'),
      body: null,
    });
    if (delayMs > 0) await delay(delayMs);
    return HttpResponse.json(
      { detected: [], updated: [], skipped: [], unchanged: [] },
      { status },
    );
  });
}

/**
 * A list handler whose total grows from `initialTotal` to `backfilledTotal`
 * after the first request. This simulates the archive refetch after a
 * successful backfill invalidation surfacing newly populated rows.
 */
function growingListHandler(
  initialTotal: number,
  backfilledTotal: number,
  captured: { count: number } = { count: 0 },
) {
  return http.get('/api/nasa/apod', ({ request }) => {
    captured.count += 1;
    const total = captured.count <= 1 ? initialTotal : backfilledTotal;
    const url = new URL(request.url);
    const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1;
    const limit =
      Number.parseInt(url.searchParams.get('limit') ?? String(PAGE_SIZE), 10) ||
      PAGE_SIZE;
    return HttpResponse.json(makeList(total, page, limit), { status: 200 });
  });
}

describe('ApodArchive — VAL-PRODFIX-007 backfill control renders', () => {
  beforeEach(() => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
  });

  it('renders a Backfill 30 days button on the archive page', async () => {
    server.use(authMeHandler(), listHandler(5));

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    await screen.findAllByTestId('apod-archive-card');
    expect(
      screen.getByTestId('apod-backfill-button'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('apod-backfill-button')).toHaveTextContent(
      /backfill 30 days/i,
    );
  });

  it('renders the backfill button in the empty state too', async () => {
    server.use(authMeHandler(), emptyListHandler());

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    await screen.findByTestId('empty-state');
    expect(
      screen.getByTestId('apod-backfill-button'),
    ).toBeInTheDocument();
  });
});

describe('ApodArchive — VAL-PRODFIX-007 click fires both POSTs with auth', () => {
  beforeEach(() => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
  });

  it('POSTs to backfill-apod?days=30 and backfill-eonet with the bearer token', async () => {
    const user = userEvent.setup();
    const apodCalls: CapturedRequest[] = [];
    const eonetCalls: CapturedRequest[] = [];
    server.use(
      authMeHandler(),
      listHandler(5),
      backfillApodHandler(apodCalls, []),
      backfillEonetHandler(eonetCalls),
    );

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    await screen.findAllByTestId('apod-archive-card');
    await user.click(screen.getByTestId('apod-backfill-button'));

    await waitFor(() => {
      expect(apodCalls).toHaveLength(1);
    });
    await waitFor(() => {
      expect(eonetCalls).toHaveLength(1);
    });

    // backfill-apod must be called with days=30 and the Authorization header.
    const apodUrl = new URL(apodCalls[0].url);
    expect(apodUrl.searchParams.get('days')).toBe('30');
    expect(apodCalls[0].auth).toBe(`Bearer ${TOKEN}`);

    // backfill-eonet must carry the Authorization header too.
    expect(eonetCalls[0].auth).toBe(`Bearer ${TOKEN}`);
  });
});

describe('ApodArchive — VAL-PRODFIX-007 button disabled while pending', () => {
  beforeEach(() => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
  });

  it('disables the button and shows a pending status while in-flight', async () => {
    const user = userEvent.setup();
    server.use(
      authMeHandler(),
      listHandler(5),
      // Delay the backfill responses so we can observe the pending state.
      backfillApodHandler([], [], 200, 500),
      backfillEonetHandler([], 200, 500),
    );

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    await screen.findAllByTestId('apod-archive-card');
    const button = screen.getByTestId('apod-backfill-button');
    expect(button).not.toBeDisabled();

    await user.click(button);

    // While in-flight the button is disabled and reflects a pending state.
    await waitFor(() => {
      expect(screen.getByTestId('apod-backfill-button')).toBeDisabled();
    });
    expect(screen.getByTestId('apod-backfill-button')).toHaveTextContent(
      /backfilling/i,
    );
    const status = screen.getByTestId('apod-backfill-status');
    expect(status).toHaveTextContent(/backfilling history/i);

    // After the responses resolve the button re-enables.
    await waitFor(() => {
      expect(screen.getByTestId('apod-backfill-button')).not.toBeDisabled();
    });
  });
});

describe('ApodArchive — VAL-PRODFIX-007 invalidation + refetch on success', () => {
  beforeEach(() => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
  });

  it('on success invalidates the archive cache so the list refetches with more entries', async () => {
    const user = userEvent.setup();
    const listCalls = { count: 0 };
    server.use(
      authMeHandler(),
      growingListHandler(5, 30, listCalls),
      backfillApodHandler([], makeList(30, 1).data),
      backfillEonetHandler(),
    );

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    // Initially 5 entries (page 1).
    const cardsBefore = await screen.findAllByTestId('apod-archive-card');
    expect(cardsBefore).toHaveLength(5);
    expect(listCalls.count).toBe(1);

    await user.click(screen.getByTestId('apod-backfill-button'));

    // The archive query is invalidated and refetches; the second list call
    // returns total=30 → page 1 shows 20 cards.
    await waitFor(() => {
      expect(listCalls.count).toBeGreaterThanOrEqual(2);
    });
    const cardsAfter = await screen.findAllByTestId('apod-archive-card');
    expect(cardsAfter).toHaveLength(20);

    // A success status message is shown.
    const status = screen.getByTestId('apod-backfill-status');
    expect(status).toHaveTextContent(/backfill complete/i);
  });
});

describe('ApodArchive — VAL-PRODFIX-007 error path handling', () => {
  beforeEach(() => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
  });

  it('full failure (both 500) shows the existing blanket error message', async () => {
    const user = userEvent.setup();
    server.use(
      authMeHandler(),
      listHandler(5),
      backfillApodHandler([], { message: 'APOD backfill failed' }, 500),
      http.post('/api/nasa/triggers/backfill-eonet', () =>
        HttpResponse.json({ message: 'EONET backfill failed' }, { status: 500 }),
      ),
    );

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    await screen.findAllByTestId('apod-archive-card');
    await user.click(screen.getByTestId('apod-backfill-button'));

    const status = await screen.findByTestId('apod-backfill-status');
    // Full-failure path keeps the blanket "Backfill failed" wording and does
    // NOT use the mixed "APOD history refreshed; EONET backfill failed" form.
    expect(status).toHaveTextContent(/backfill failed/i);
    expect(status).not.toHaveTextContent(/APOD history refreshed/i);
    expect(status).not.toHaveTextContent(/EONET backfill refreshed/i);
    await waitFor(() => {
      expect(screen.getByTestId('apod-backfill-button')).not.toBeDisabled();
    });
  });
});

// ---------------------------------------------------------------------------
// misc-m12-polish: mixed-outcome path (APOD 200 + EONET 500)
// ---------------------------------------------------------------------------
//
// When APOD backfill succeeds but EONET backfill fails, the archive must
// STILL refetch (APOD rows were upserted) and `apod-backfill-status` must
// convey the EONET failure distinctly (a mixed status mentioning both the
// APOD refresh and the EONET failure), instead of a blanket error that
// implies nothing happened. The full-success and full-failure messages stay
// unchanged (covered above and in the success-path suite).

describe('ApodArchive — misc-m12-polish mixed outcome (APOD ok, EONET 500)', () => {
  beforeEach(() => {
    localStorage.setItem(AUTH_TOKEN_KEY, TOKEN);
  });

  it('archive still refetches and status conveys the EONET failure distinctly', async () => {
    const user = userEvent.setup();
    const apodCalls: CapturedRequest[] = [];
    const eonetCalls: CapturedRequest[] = [];
    const listCalls = { count: 0 };
    server.use(
      authMeHandler(),
      // Archive total grows from 5 to 30 after the first request, so the
      // post-invalidation refetch surfaces newly backfilled APOD rows.
      growingListHandler(5, 30, listCalls),
      backfillApodHandler(apodCalls, makeList(30, 1).data),
      http.post('/api/nasa/triggers/backfill-eonet', async ({ request }) => {
        eonetCalls.push({
          url: request.url,
          auth: request.headers.get('authorization'),
          body: null,
        });
        return HttpResponse.json(
          { message: 'EONET backfill failed' },
          { status: 500 },
        );
      }),
    );

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    // Initially 5 entries (page 1) — one list call on mount.
    const cardsBefore = await screen.findAllByTestId('apod-archive-card');
    expect(cardsBefore).toHaveLength(5);
    expect(listCalls.count).toBe(1);

    await user.click(screen.getByTestId('apod-backfill-button'));

    // Both backfill triggers fired.
    await waitFor(() => {
      expect(apodCalls).toHaveLength(1);
    });
    await waitFor(() => {
      expect(eonetCalls).toHaveLength(1);
    });

    // APOD backfill succeeded → archive cache invalidated → list refetches
    // (second list call) and now surfaces 20 cards (total=30, page 1).
    await waitFor(() => {
      expect(listCalls.count).toBeGreaterThanOrEqual(2);
    });
    const cardsAfter = await screen.findAllByTestId('apod-archive-card');
    expect(cardsAfter).toHaveLength(20);

    // Mixed status: mentions BOTH the APOD refresh AND the EONET failure
    // (not a blanket "Backfill failed" that implies nothing happened).
    const status = await screen.findByTestId('apod-backfill-status');
    expect(status).toHaveTextContent(/APOD history refreshed/i);
    expect(status).toHaveTextContent(/EONET backfill failed/i);
    // And it must NOT collapse to the generic full-failure wording.
    expect(status).not.toHaveTextContent(/^Backfill failed\.?\s*$/i);

    // Button re-enables after the mixed outcome.
    await waitFor(() => {
      expect(screen.getByTestId('apod-backfill-button')).not.toBeDisabled();
    });
  });

  it('mixed outcome (APOD 500 + EONET 200) surfaces a distinct mixed status with backend error', async () => {
    const user = userEvent.setup();
    server.use(
      authMeHandler(),
      listHandler(5),
      backfillApodHandler(
        [],
        { message: 'days must be an integer between 1 and 30' },
        500,
      ),
      backfillEonetHandler(),
    );

    renderWithProviders(<ArchiveTree />, {
      routerProps: { initialEntries: ['/apod/archive'] },
    });

    await screen.findAllByTestId('apod-archive-card');
    await user.click(screen.getByTestId('apod-backfill-button'));

    const status = await screen.findByTestId('apod-backfill-status');
    // APOD failed, EONET succeeded: mixed status mentions both halves and
    // surfaces the backend error message from the APOD rejection.
    expect(status).toHaveTextContent(/APOD backfill failed/i);
    expect(status).toHaveTextContent(/integer between 1 and 30/i);
    expect(status).toHaveTextContent(/EONET backfill refreshed/i);
    await waitFor(() => {
      expect(screen.getByTestId('apod-backfill-button')).not.toBeDisabled();
    });
  });
});
