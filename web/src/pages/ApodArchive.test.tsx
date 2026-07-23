import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { ApodArchive } from './ApodArchive';
import { server } from '../test/server';

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
