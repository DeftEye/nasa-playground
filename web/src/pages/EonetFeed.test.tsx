import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { EonetFeed } from './EonetFeed';
import { server } from '../test/server';
import type { EonetCategory, EonetEvent } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CATEGORIES: EonetCategory[] = [
  { id: 'severeStorms', title: 'Severe Storms', description: null },
  { id: 'wildfires', title: 'Wildfires', description: null },
  { id: 'volcanoes', title: 'Volcanoes', description: null },
];

function makeEvent(
  id: string,
  overrides: Partial<EonetEvent> = {},
): EonetEvent {
  return {
    id,
    title: `Event ${id}`,
    description: null,
    link: `https://eonet.gsfc.nasa.gov/api/v3/events/${id}`,
    status: 'open',
    closedAt: null,
    firstSeenAt: '2025-07-22T10:00:00.000Z',
    lastSeenAt: '2025-07-22T12:00:00.000Z',
    geometry: [{ type: 'Point', coordinates: [0, 0] }],
    ...overrides,
  };
}

// A dataset where each event has a known category + status so filter
// intersections are easy to reason about.
const DATASET: Array<{
  event: EonetEvent;
  category: string;
}> = [
  { event: makeEvent('E1', { title: 'Storm One', status: 'open' }), category: 'severeStorms' },
  { event: makeEvent('E2', { title: 'Storm Two', status: 'closed' }), category: 'severeStorms' },
  { event: makeEvent('E3', { title: 'Fire One', status: 'open' }), category: 'wildfires' },
  { event: makeEvent('E4', { title: 'Volcano One', status: 'closed' }), category: 'volcanoes' },
];

function categoriesHandler() {
  return http.get('/api/nasa/eonet/categories', () =>
    HttpResponse.json(CATEGORIES, { status: 200 }),
  );
}

/**
 * Events handler that applies `category` + `status` as an intersection and
 * returns `{data, total, page, limit}`. Records the parsed query params on
 * `captured` so tests can assert the request shape (VAL-FE-EONET-002/005).
 */
function eventsHandler(captured: { url: string } = { url: '' }) {
  return http.get('/api/nasa/eonet/events', ({ request }) => {
    const url = new URL(request.url);
    captured.url = request.url;
    const category = url.searchParams.get('category') ?? undefined;
    const status = url.searchParams.get('status') ?? undefined;
    const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1;
    const limit =
      Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;

    let rows = DATASET.filter((d) => {
      if (category && d.category !== category) return false;
      if (status && d.event.status !== status) return false;
      return true;
    }).map((d) => d.event);

    const total = rows.length;
    const start = (page - 1) * limit;
    rows = rows.slice(start, start + limit);
    return HttpResponse.json({ data: rows, total, page, limit }, { status: 200 });
  });
}

function emptyEventsHandler() {
  return http.get('/api/nasa/eonet/events', () =>
    HttpResponse.json(
      { data: [], total: 0, page: 1, limit: 50 },
      { status: 200 },
    ),
  );
}

function errorEventsHandler() {
  return http.get('/api/nasa/eonet/events', () =>
    HttpResponse.json({ message: 'boom' }, { status: 500 }),
  );
}

function delayedEventsHandler(ms = 500) {
  return http.get('/api/nasa/eonet/events', async () => {
    await delay(ms);
    return HttpResponse.json(
      { data: DATASET.map((d) => d.event), total: DATASET.length, page: 1, limit: 50 },
      { status: 200 },
    );
  });
}

function EonetTree() {
  return (
    <Routes>
      <Route path="/eonet" element={<EonetFeed />} />
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
// VAL-FE-EONET-001: category chips + status pills + per-event status pills
// ---------------------------------------------------------------------------

describe('EonetFeed — VAL-FE-EONET-001 chips, pills, and event list', () => {
  it('renders category chips, status pills, and events with status pills', async () => {
    server.use(categoriesHandler(), eventsHandler());

    renderWithProviders(<EonetTree />, {
      routerProps: { initialEntries: ['/eonet'] },
    });

    // Category chips (All + one per category).
    const chips = await screen.findAllByTestId('eonet-category-chip');
    expect(chips).toHaveLength(1 + CATEGORIES.length);
    expect(chips.some((c) => c.textContent === 'Severe Storms')).toBe(true);

    // Status pills.
    const pills = await screen.findAllByTestId('eonet-status-pill');
    expect(pills).toHaveLength(3); // All / Open / Closed

    // Event cards with per-event status pills.
    const cards = await screen.findAllByTestId('eonet-event-card');
    expect(cards).toHaveLength(DATASET.length);
    expect(
      screen.getAllByTestId('eonet-event-status').map((p) => p.textContent),
    ).toEqual(['open', 'closed', 'open', 'closed']);
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-EONET-002: selecting a category filter refreshes the list
// ---------------------------------------------------------------------------

describe('EonetFeed — VAL-FE-EONET-002 category filter', () => {
  it('clicking a category chip filters the list and sends category=', async () => {
    const user = userEvent.setup();
    const captured = { url: '' };
    server.use(categoriesHandler(), eventsHandler(captured));

    renderWithProviders(<EonetTree />, {
      routerProps: { initialEntries: ['/eonet'] },
    });

    await screen.findAllByTestId('eonet-event-card');

    const stormChip = screen
      .getAllByTestId('eonet-category-chip')
      .find((c) => c.getAttribute('data-category') === 'severeStorms')!;
    await user.click(stormChip);

    await waitFor(() => {
      expect(new URL(captured.url).searchParams.get('category')).toBe(
        'severeStorms',
      );
    });

    const cards = await screen.findAllByTestId('eonet-event-card');
    expect(cards).toHaveLength(2); // E1 + E2
    expect(cards.every((c) => c.textContent?.includes('Storm'))).toBe(true);

    // Active-filter indicator visible.
    expect(screen.getByTestId('eonet-active-filters')).toBeInTheDocument();
    expect(
      screen
        .getAllByTestId('eonet-active-filter')
        .some((b) => b.getAttribute('data-filter') === 'category'),
    ).toBe(true);
    // The selected chip is marked active (re-query to avoid a stale node
    // reference after the state-driven re-render).
    const stormChipAfter = screen
      .getAllByTestId('eonet-category-chip')
      .find((c) => c.getAttribute('data-category') === 'severeStorms')!;
    expect(stormChipAfter).toHaveAttribute('data-active', 'true');
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-EONET-003: status filter shows only open or only closed events
// ---------------------------------------------------------------------------

describe('EonetFeed — VAL-FE-EONET-003 status filter', () => {
  it('clicking Open shows only open events; clicking Closed shows only closed', async () => {
    const user = userEvent.setup();
    const captured = { url: '' };
    server.use(categoriesHandler(), eventsHandler(captured));

    renderWithProviders(<EonetTree />, {
      routerProps: { initialEntries: ['/eonet'] },
    });

    await screen.findAllByTestId('eonet-event-card');

    const openPill = screen
      .getAllByTestId('eonet-status-pill')
      .find((p) => p.getAttribute('data-status') === 'open')!;
    await user.click(openPill);

    await waitFor(() => {
      expect(new URL(captured.url).searchParams.get('status')).toBe('open');
    });
    let cards = screen.getAllByTestId('eonet-event-card');
    expect(cards).toHaveLength(2); // E1 + E3
    expect(
      screen.getAllByTestId('eonet-event-status').map((p) => p.textContent),
    ).toEqual(['open', 'open']);

    const closedPill = screen
      .getAllByTestId('eonet-status-pill')
      .find((p) => p.getAttribute('data-status') === 'closed')!;
    await user.click(closedPill);

    await waitFor(() => {
      expect(new URL(captured.url).searchParams.get('status')).toBe('closed');
    });
    cards = screen.getAllByTestId('eonet-event-card');
    expect(cards).toHaveLength(2); // E2 + E4
    expect(
      screen.getAllByTestId('eonet-event-status').map((p) => p.textContent),
    ).toEqual(['closed', 'closed']);
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-EONET-004: filtered empty state
// ---------------------------------------------------------------------------

describe('EonetFeed — VAL-FE-EONET-004 filtered empty state', () => {
  it('shows "No events match this filter" when a filter matches nothing', async () => {
    const user = userEvent.setup();
    server.use(categoriesHandler(), eventsHandler());

    renderWithProviders(<EonetTree />, {
      routerProps: { initialEntries: ['/eonet'] },
    });

    await screen.findAllByTestId('eonet-event-card');

    // wildfires + closed => no events match.
    const fireChip = screen
      .getAllByTestId('eonet-category-chip')
      .find((c) => c.getAttribute('data-category') === 'wildfires')!;
    await user.click(fireChip);
    const closedPill = screen
      .getAllByTestId('eonet-status-pill')
      .find((p) => p.getAttribute('data-status') === 'closed')!;
    await user.click(closedPill);

    const empty = await screen.findByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'filtered');
    expect(empty).toHaveTextContent('No events match this filter');
    expect(screen.queryByTestId('eonet-event-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('eonet-pagination')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-EONET-005: combined category + status filters both applied
// ---------------------------------------------------------------------------

describe('EonetFeed — VAL-FE-EONET-005 combined filters', () => {
  it('sends both category and status params and shows the intersection', async () => {
    const user = userEvent.setup();
    const captured = { url: '' };
    server.use(categoriesHandler(), eventsHandler(captured));

    renderWithProviders(<EonetTree />, {
      routerProps: { initialEntries: ['/eonet'] },
    });

    await screen.findAllByTestId('eonet-event-card');

    const stormChip = screen
      .getAllByTestId('eonet-category-chip')
      .find((c) => c.getAttribute('data-category') === 'severeStorms')!;
    await user.click(stormChip);
    const openPill = screen
      .getAllByTestId('eonet-status-pill')
      .find((p) => p.getAttribute('data-status') === 'open')!;
    await user.click(openPill);

    await waitFor(() => {
      const u = new URL(captured.url);
      expect(u.searchParams.get('category')).toBe('severeStorms');
      expect(u.searchParams.get('status')).toBe('open');
    });

    const cards = screen.getAllByTestId('eonet-event-card');
    expect(cards).toHaveLength(1); // only E1 (severeStorms + open)
    expect(cards[0]).toHaveTextContent('Storm One');

    // Both active filters have visible affordances.
    const active = screen.getAllByTestId('eonet-active-filter');
    expect(
      active.some((b) => b.getAttribute('data-filter') === 'category'),
    ).toBe(true);
    expect(
      active.some((b) => b.getAttribute('data-filter') === 'status'),
    ).toBe(true);
    // Re-query to avoid stale node references after re-render.
    const stormChipAfter = screen
      .getAllByTestId('eonet-category-chip')
      .find((c) => c.getAttribute('data-category') === 'severeStorms')!;
    const openPillAfter = screen
      .getAllByTestId('eonet-status-pill')
      .find((p) => p.getAttribute('data-status') === 'open')!;
    expect(stormChipAfter).toHaveAttribute('data-active', 'true');
    expect(openPillAfter).toHaveAttribute('data-active', 'true');
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-EONET-006: zero-total empty state distinct from filtered-empty
// ---------------------------------------------------------------------------

describe('EonetFeed — VAL-FE-EONET-006 zero-total empty state', () => {
  it('shows "No events tracked yet" and no pagination when backend has zero events', async () => {
    server.use(categoriesHandler(), emptyEventsHandler());

    renderWithProviders(<EonetTree />, {
      routerProps: { initialEntries: ['/eonet'] },
    });

    const empty = await screen.findByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'zero');
    expect(empty).toHaveTextContent('No events tracked yet');
    expect(screen.queryByTestId('eonet-pagination')).not.toBeInTheDocument();
    expect(screen.queryByTestId('eonet-event-card')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-EONET-007: loading skeleton shown until data populates
// ---------------------------------------------------------------------------

describe('EonetFeed — VAL-FE-EONET-007 loading skeleton', () => {
  it('renders a skeleton while the events fetch is pending, then the list', async () => {
    server.use(categoriesHandler(), delayedEventsHandler(500));

    renderWithProviders(<EonetTree />, {
      routerProps: { initialEntries: ['/eonet'] },
    });

    expect(await screen.findByTestId('eonet-skeleton')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByTestId('eonet-event-card').length).toBeGreaterThan(
        0,
      );
    });
    expect(screen.queryByTestId('eonet-skeleton')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-ERR-003: 5xx error state with Retry
// ---------------------------------------------------------------------------

describe('EonetFeed — VAL-FE-ERR-003 5xx error and retry', () => {
  it('renders an inline error with a Retry button on 500', async () => {
    server.use(categoriesHandler(), errorEventsHandler());

    renderWithProviders(<EonetTree />, {
      routerProps: { initialEntries: ['/eonet'] },
    });

    const errorState = await screen.findByTestId('error-state');
    expect(errorState).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('clicking Retry re-runs the query and renders the list', async () => {
    const user = userEvent.setup();
    let callCount = 0;
    server.use(
      categoriesHandler(),
      http.get('/api/nasa/eonet/events', () => {
        callCount += 1;
        if (callCount === 1) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json(
          { data: DATASET.map((d) => d.event), total: DATASET.length, page: 1, limit: 50 },
          { status: 200 },
        );
      }),
    );

    renderWithProviders(<EonetTree />, {
      routerProps: { initialEntries: ['/eonet'] },
    });

    const retry = await screen.findByRole('button', { name: /retry/i });
    await user.click(retry);

    await waitFor(() => {
      expect(screen.getAllByTestId('eonet-event-card').length).toBeGreaterThan(
        0,
      );
    });
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Extra: clearing an active filter via its badge restores the full list
// ---------------------------------------------------------------------------

describe('EonetFeed — clearing an active filter badge', () => {
  it('clicking the category active-filter badge clears the category filter', async () => {
    const user = userEvent.setup();
    const captured = { url: '' };
    server.use(categoriesHandler(), eventsHandler(captured));

    renderWithProviders(<EonetTree />, {
      routerProps: { initialEntries: ['/eonet'] },
    });

    await screen.findAllByTestId('eonet-event-card');

    const stormChip = screen
      .getAllByTestId('eonet-category-chip')
      .find((c) => c.getAttribute('data-category') === 'severeStorms')!;
    await user.click(stormChip);

    await waitFor(() => {
      expect(screen.getAllByTestId('eonet-event-card').length).toBe(2);
    });

    const catBadge = screen
      .getAllByTestId('eonet-active-filter')
      .find((b) => b.getAttribute('data-filter') === 'category')!;
    await user.click(catBadge);

    await waitFor(() => {
      expect(new URL(captured.url).searchParams.get('category')).toBeNull();
    });
    expect(screen.getAllByTestId('eonet-event-card').length).toBe(
      DATASET.length,
    );
  });
});

// ---------------------------------------------------------------------------
// M5 polish: category-chip row surfaces inline ErrorState+Retry when
// /api/nasa/eonet/categories 5xx errors
// ---------------------------------------------------------------------------

describe('EonetFeed — M5 polish: category error state', () => {
  it('shows inline error + retry when categories 5xx, events still render', async () => {
    server.use(
      http.get('/api/nasa/eonet/categories', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
      eventsHandler(),
    );

    renderWithProviders(<EonetTree />, {
      routerProps: { initialEntries: ['/eonet'] },
    });

    // Wait for events to render (categories failure doesn't block events).
    await screen.findAllByTestId('eonet-event-card');

    // Category error indicator should be visible.
    await waitFor(() => {
      expect(screen.getByTestId('eonet-categories-error')).toBeInTheDocument();
    });

    // Retry button present.
    expect(screen.getByTestId('eonet-categories-retry')).toBeInTheDocument();
  });

  it('retry re-fetches categories and clears error on success', async () => {
    let categoriesFail = true;
    server.use(
      http.get('/api/nasa/eonet/categories', () => {
        if (categoriesFail) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json(CATEGORIES, { status: 200 });
      }),
      eventsHandler(),
    );

    const user = userEvent.setup();
    renderWithProviders(<EonetTree />, {
      routerProps: { initialEntries: ['/eonet'] },
    });

    // Wait for error to appear.
    await screen.findAllByTestId('eonet-event-card');
    await waitFor(() => {
      expect(screen.getByTestId('eonet-categories-error')).toBeInTheDocument();
    });

    // Fix the handler and click retry.
    categoriesFail = false;
    await user.click(screen.getByTestId('eonet-categories-retry'));

    // Error should disappear and category chips should appear.
    await waitFor(() => {
      expect(screen.queryByTestId('eonet-categories-error')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      const chips = screen.getAllByTestId('eonet-category-chip');
      // "All" + 3 categories = 4 chips
      expect(chips.length).toBe(1 + CATEGORIES.length);
    });
  });
});
