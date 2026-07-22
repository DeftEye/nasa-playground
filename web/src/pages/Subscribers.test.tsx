import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { Subscribers } from './Subscribers';
import { server } from '../test/server';
import type {
  EonetCategory,
  PublicSubscriber,
  TestNotificationResult,
} from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CATEGORIES: EonetCategory[] = [
  { id: 'severeStorms', title: 'Severe Storms', description: null },
  { id: 'wildfires', title: 'Wildfires', description: null },
  { id: 'volcanoes', title: 'Volcanoes', description: null },
];

const validWebhookUrl =
  'https://discord.com/api/webhooks/1234567890/abcdef123456';

function makeSubscriber(
  id: string,
  overrides: Partial<PublicSubscriber> = {},
): PublicSubscriber {
  return {
    id,
    name: `Subscriber ${id}`,
    apodEnabled: true,
    enabled: true,
    eonetCategorySlugs: ['severeStorms'],
    maskedWebhookUrl: '/webhooks/.../3456',
    createdAt: '2025-07-22T10:00:00.000Z',
    ...overrides,
  };
}

const ROWS: PublicSubscriber[] = [
  makeSubscriber('s1', { name: 'Storm Channel', eonetCategorySlugs: ['severeStorms'] }),
  makeSubscriber('s2', {
    name: 'Fire & Volcano',
    eonetCategorySlugs: ['wildfires', 'volcanoes'],
    apodEnabled: false,
    maskedWebhookUrl: '/webhooks/.../abcd',
  }),
];

// ---------------------------------------------------------------------------
// MSW handlers
// ---------------------------------------------------------------------------

function categoriesHandler() {
  return http.get('/api/nasa/eonet/categories', () =>
    HttpResponse.json(CATEGORIES, { status: 200 }),
  );
}

function listHandler(rows: PublicSubscriber[] = ROWS) {
  return http.get('/api/subscribers', () =>
    HttpResponse.json(rows, { status: 200 }),
  );
}

function emptyListHandler() {
  return http.get('/api/subscribers', () => HttpResponse.json([], { status: 200 }));
}

function errorListHandler() {
  return http.get('/api/subscribers', () =>
    HttpResponse.json({ message: 'boom' }, { status: 500 }),
  );
}

function delayedListHandler(rows: PublicSubscriber[] = ROWS, ms = 500) {
  return http.get('/api/subscribers', async () => {
    await delay(ms);
    return HttpResponse.json(rows, { status: 200 });
  });
}

/**
 * A create handler that echoes back a PublicSubscriber with a masked URL and
 * NO raw `discordWebhookUrl` field (VAL-SUB-001). Records the received body
 * on `captured` so tests can assert the request shape (VAL-FE-SUB-002/008).
 */
function createHandler(captured: { body: Record<string, unknown> | null } = { body: null }) {
  return http.post('/api/subscribers', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    captured.body = body;
    const created = makeSubscriber('s-new', {
      name: body.name as string,
      apodEnabled: body.apodEnabled as boolean,
      eonetCategorySlugs: body.eonetCategorySlugs as string[],
      maskedWebhookUrl: '/webhooks/.../3456',
    });
    return HttpResponse.json(created, { status: 201 });
  });
}

function deleteHandler(captured: { ids: string[] } = { ids: [] }) {
  return http.delete('/api/subscribers/:id', ({ params }) => {
    captured.ids.push(params.id as string);
    return new HttpResponse(null, { status: 204 });
  });
}

function testNotificationHandler(
  result: TestNotificationResult = { id: 'log-1', status: 'mocked' },
) {
  return http.post('/api/subscribers/:id/test-notification', () =>
    HttpResponse.json(result, { status: 200 }),
  );
}

function SubscribersTree() {
  return (
    <Routes>
      <Route path="/subscribers" element={<Subscribers />} />
    </Routes>
  );
}

beforeEach(() => {
  localStorage.setItem('auth_token', 'fake-jwt');
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// VAL-FE-SUB-001: empty state + add form visible
// ---------------------------------------------------------------------------

describe('Subscribers — VAL-FE-SUB-001 empty state', () => {
  it('shows an empty-state message and the add form when the list is empty', async () => {
    server.use(categoriesHandler(), emptyListHandler());

    renderWithProviders(<SubscribersTree />, {
      routerProps: { initialEntries: ['/subscribers'] },
    });

    const empty = await screen.findByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'zero');
    // Add form is visible alongside the empty state.
    expect(screen.getByTestId('add-subscriber-form')).toBeInTheDocument();
    expect(screen.queryByTestId('subscribers-list')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-SUB-002: add form validates webhook URL format
// ---------------------------------------------------------------------------

describe('Subscribers — VAL-FE-SUB-002 webhook URL validation', () => {
  it('rejects `not-a-url` with a field error and sends no POST', async () => {
    const user = userEvent.setup();
    const captured: { body: Record<string, unknown> | null } = { body: null };
    const posts: string[] = [];
    server.use(
      categoriesHandler(),
      listHandler(),
      createHandler(captured),
      http.post('/api/subscribers', ({ request }) => {
        posts.push(request.url);
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    renderWithProviders(<SubscribersTree />, {
      routerProps: { initialEntries: ['/subscribers'] },
    });

    await screen.findByTestId('subscribers-list');

    await user.type(screen.getByTestId('sub-name-input'), 'My Sub');
    await user.type(screen.getByTestId('sub-webhook-input'), 'not-a-url');
    await user.click(screen.getByTestId('add-subscriber-submit'));

    expect(await screen.findByTestId('sub-webhook-error')).toBeInTheDocument();
    expect(captured.body).toBeNull();
    expect(posts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-SUB-003: add form supports category checkboxes + apodEnabled
// ---------------------------------------------------------------------------

describe('Subscribers — VAL-FE-SUB-003 add with categories + apodEnabled', () => {
  it('creates a subscriber with two categories and apodEnabled, row appears', async () => {
    const user = userEvent.setup();
    const captured: { body: Record<string, unknown> | null } = { body: null };
    // List starts empty; after create, the invalidation refetches and we
    // return the new row.
    let createdRow: PublicSubscriber | null = null;
    server.use(
      categoriesHandler(),
      http.get('/api/subscribers', () =>
        HttpResponse.json(createdRow ? [createdRow] : [], { status: 200 }),
      ),
      http.post('/api/subscribers', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        captured.body = body;
        createdRow = makeSubscriber('s-new', {
          name: body.name as string,
          apodEnabled: body.apodEnabled as boolean,
          eonetCategorySlugs: body.eonetCategorySlugs as string[],
        });
        return HttpResponse.json(createdRow, { status: 201 });
      }),
    );

    renderWithProviders(<SubscribersTree />, {
      routerProps: { initialEntries: ['/subscribers'] },
    });

    await screen.findByTestId('empty-state');

    await user.type(screen.getByTestId('sub-name-input'), 'Channel One');
    await user.type(
      screen.getByTestId('sub-webhook-input'),
      validWebhookUrl,
    );
    // Check two categories.
    const checkboxes = screen.getAllByTestId('sub-category-checkbox');
    const severe = checkboxes.find(
      (cb) => cb.getAttribute('data-category') === 'severeStorms',
    )!;
    const wildfires = checkboxes.find(
      (cb) => cb.getAttribute('data-category') === 'wildfires',
    )!;
    await user.click(severe);
    await user.click(wildfires);
    // apodEnabled defaults to true; toggle it off then on to exercise it.
    await user.click(screen.getByTestId('sub-apod-toggle'));
    await user.click(screen.getByTestId('sub-apod-toggle'));

    await user.click(screen.getByTestId('add-subscriber-submit'));

    await waitFor(() => {
      expect(captured.body).not.toBeNull();
    });
    expect(captured.body).toMatchObject({
      name: 'Channel One',
      discordWebhookUrl: validWebhookUrl,
      apodEnabled: true,
      eonetCategorySlugs: ['severeStorms', 'wildfires'],
    });

    // The new row appears in the list.
    await screen.findByTestId('subscribers-list');
    const rows = await screen.findAllByTestId('subscriber-row');
    expect(rows).toHaveLength(1);
    expect(screen.getByTestId('subscriber-name').textContent).toBe(
      'Channel One',
    );
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-SUB-004: rows mask the webhook URL
// ---------------------------------------------------------------------------

describe('Subscribers — VAL-FE-SUB-004 masked webhook URL', () => {
  it('shows the masked URL per row; the raw Discord URL never appears', async () => {
    server.use(categoriesHandler(), listHandler());

    renderWithProviders(<SubscribersTree />, {
      routerProps: { initialEntries: ['/subscribers'] },
    });

    const masked = await screen.findAllByTestId('subscriber-masked-webhook');
    expect(masked.length).toBeGreaterThan(0);
    // Masked form present.
    expect(masked[0].textContent).toMatch(/\/webhooks\/\.\.\.\/\w{4}/);
    // Raw Discord URL never in the DOM.
    expect(document.body.textContent).not.toContain(
      'discord.com/api/webhooks/1234567890/abcdef123456',
    );
    expect(document.body.textContent).not.toContain('discordWebhookUrl');
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-SUB-005: edit updates the row in place (no full reload)
// ---------------------------------------------------------------------------

describe('Subscribers — VAL-FE-SUB-005 edit in place', () => {
  it('PATCHes name + categories and the row reflects new values in place', async () => {
    const user = userEvent.setup();
    const captured: { body: Record<string, unknown> | null } = { body: null };
    // Shared list state so the post-invalidation refetch reflects the PATCH.
    const currentRows: PublicSubscriber[] = ROWS.map((r) => ({ ...r }));
    server.use(
      categoriesHandler(),
      http.get('/api/subscribers', () =>
        HttpResponse.json(currentRows, { status: 200 }),
      ),
      http.patch('/api/subscribers/:id', async ({ request, params }) => {
        const body = (await request.json()) as Record<string, unknown>;
        captured.body = body;
        const id = params.id as string;
        const idx = currentRows.findIndex((r) => r.id === id);
        if (idx !== -1) {
          currentRows[idx] = {
            ...currentRows[idx],
            name: (body.name as string) ?? currentRows[idx].name,
            apodEnabled:
              body.apodEnabled === undefined
                ? currentRows[idx].apodEnabled
                : (body.apodEnabled as boolean),
            eonetCategorySlugs:
              body.eonetCategorySlugs === undefined
                ? currentRows[idx].eonetCategorySlugs
                : (body.eonetCategorySlugs as string[]),
          };
        }
        return HttpResponse.json(
          idx !== -1 ? currentRows[idx] : currentRows[0],
          { status: 200 },
        );
      }),
    );

    renderWithProviders(<SubscribersTree />, {
      routerProps: { initialEntries: ['/subscribers'] },
    });

    const rows = await screen.findAllByTestId('subscriber-row');
    await user.click(rows[0].querySelector('[data-testid="subscriber-edit-btn"]')!);

    const nameInput = await screen.findByTestId('edit-name-input');
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed Channel');

    // Change categories: uncheck severeStorms, check volcanoes.
    const checkboxes = screen.getAllByTestId('edit-category-checkbox');
    const severe = checkboxes.find(
      (cb) => cb.getAttribute('data-category') === 'severeStorms',
    )!;
    const volcanoes = checkboxes.find(
      (cb) => cb.getAttribute('data-category') === 'volcanoes',
    )!;
    await user.click(severe); // uncheck
    await user.click(volcanoes); // check

    await user.click(screen.getByTestId('edit-save-btn'));

    await waitFor(() => {
      expect(captured.body).not.toBeNull();
    });
    expect(captured.body).toMatchObject({
      name: 'Renamed Channel',
      eonetCategorySlugs: ['volcanoes'],
    });

    // Row reflects new values in place (no full reload — the edit form is
    // replaced by the row display).
    await waitFor(() => {
      expect(screen.queryByTestId('subscriber-edit-form')).not.toBeInTheDocument();
    });
    // Only one row has the edited id; its name reflects the PATCH.
    const editedRows = screen.getAllByTestId('subscriber-row');
    const edited = editedRows.find(
      (r) => r.getAttribute('data-subscriber-id') === 's1',
    )!;
    expect(
      edited.querySelector('[data-testid="subscriber-name"]')!.textContent,
    ).toBe('Renamed Channel');
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-SUB-006: delete confirmation modal; cancel doesn't DELETE
// ---------------------------------------------------------------------------

describe('Subscribers — VAL-FE-SUB-006 delete confirmation', () => {
  it('opens a confirmation modal; cancel does not send DELETE', async () => {
    const user = userEvent.setup();
    const captured: { ids: string[] } = { ids: [] };
    server.use(categoriesHandler(), listHandler(), deleteHandler(captured));

    renderWithProviders(<SubscribersTree />, {
      routerProps: { initialEntries: ['/subscribers'] },
    });

    const rows = await screen.findAllByTestId('subscriber-row');
    await user.click(rows[0].querySelector('[data-testid="subscriber-delete-btn"]')!);

    const modal = await screen.findByTestId('delete-modal');
    expect(modal).toBeInTheDocument();

    await user.click(screen.getByTestId('delete-cancel-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('delete-modal')).not.toBeInTheDocument();
    });
    // Cancel: no DELETE sent.
    expect(captured.ids).toHaveLength(0);
  });

  it('confirm sends DELETE and the row is removed', async () => {
    const user = userEvent.setup();
    const captured: { ids: string[] } = { ids: [] };
    // Shared list state so the post-invalidation refetch omits the deleted row.
    const currentRows: PublicSubscriber[] = ROWS.map((r) => ({ ...r }));
    server.use(
      categoriesHandler(),
      http.get('/api/subscribers', () =>
        HttpResponse.json(currentRows, { status: 200 }),
      ),
      http.delete('/api/subscribers/:id', ({ params }) => {
        const id = params.id as string;
        captured.ids.push(id);
        const idx = currentRows.findIndex((r) => r.id === id);
        if (idx !== -1) currentRows.splice(idx, 1);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<SubscribersTree />, {
      routerProps: { initialEntries: ['/subscribers'] },
    });

    const rows = await screen.findAllByTestId('subscriber-row');
    const firstId = rows[0].getAttribute('data-subscriber-id');
    await user.click(rows[0].querySelector('[data-testid="subscriber-delete-btn"]')!);

    await user.click(await screen.findByTestId('delete-confirm-btn'));

    await waitFor(() => {
      expect(captured.ids).toContain(firstId);
    });
    // Row removed from the list.
    await waitFor(() => {
      const remaining = screen.getAllByTestId('subscriber-row');
      expect(
        remaining.map((r) => r.getAttribute('data-subscriber-id')),
      ).not.toContain(firstId);
    });
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-SUB-007: send test happy path
// ---------------------------------------------------------------------------

describe('Subscribers — VAL-FE-SUB-007 send test happy path', () => {
  it('POSTs test-notification and shows a success indicator', async () => {
    const user = userEvent.setup();
    const postedIds: string[] = [];
    server.use(
      categoriesHandler(),
      listHandler(),
      http.post('/api/subscribers/:id/test-notification', ({ params }) => {
        postedIds.push(params.id as string);
        return HttpResponse.json(
          { id: 'log-1', status: 'mocked' },
          { status: 200 },
        );
      }),
    );

    renderWithProviders(<SubscribersTree />, {
      routerProps: { initialEntries: ['/subscribers'] },
    });

    const rows = await screen.findAllByTestId('subscriber-row');
    const firstId = rows[0].getAttribute('data-subscriber-id');
    await user.click(rows[0].querySelector('[data-testid="subscriber-send-test-btn"]')!);

    await waitFor(() => {
      expect(postedIds).toContain(firstId);
    });
    const success = await screen.findByTestId('subscriber-test-success');
    expect(success.textContent).toContain('mocked');
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-SUB-008: add form rejects empty name + empty webhook URL
// ---------------------------------------------------------------------------

describe('Subscribers — VAL-FE-SUB-008 empty-field validation', () => {
  it('rejects empty name AND empty webhook URL with field errors; no POST', async () => {
    const user = userEvent.setup();
    const captured: { body: Record<string, unknown> | null } = { body: null };
    server.use(categoriesHandler(), listHandler(), createHandler(captured));

    renderWithProviders(<SubscribersTree />, {
      routerProps: { initialEntries: ['/subscribers'] },
    });

    await screen.findByTestId('subscribers-list');

    // Submit without filling anything.
    await user.click(screen.getByTestId('add-subscriber-submit'));

    expect(await screen.findByTestId('sub-name-error')).toBeInTheDocument();
    expect(await screen.findByTestId('sub-webhook-error')).toBeInTheDocument();
    expect(captured.body).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-SUB-009: send test failure visible on the FE (status='failed')
// ---------------------------------------------------------------------------

describe('Subscribers — VAL-FE-SUB-009 send test failure', () => {
  it('shows a failed indicator when the test-notification returns status=failed', async () => {
    const user = userEvent.setup();
    server.use(
      categoriesHandler(),
      listHandler(),
      testNotificationHandler({ id: 'log-fail', status: 'failed' }),
    );

    renderWithProviders(<SubscribersTree />, {
      routerProps: { initialEntries: ['/subscribers'] },
    });

    const rows = await screen.findAllByTestId('subscriber-row');
    await user.click(rows[0].querySelector('[data-testid="subscriber-send-test-btn"]')!);

    const failed = await screen.findByTestId('subscriber-test-failed');
    expect(failed).toBeInTheDocument();
    const result = screen.getByTestId('subscriber-test-result');
    expect(result.getAttribute('data-test-status')).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-SUB-010: loading skeleton shown until data populates
// ---------------------------------------------------------------------------

describe('Subscribers — VAL-FE-SUB-010 loading skeleton', () => {
  it('renders a skeleton while the fetch is pending, then the list', async () => {
    server.use(categoriesHandler(), delayedListHandler(ROWS, 500));

    renderWithProviders(<SubscribersTree />, {
      routerProps: { initialEntries: ['/subscribers'] },
    });

    expect(await screen.findByTestId('subscribers-skeleton')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByTestId('subscriber-row').length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('subscribers-skeleton')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Extra: 5xx error state with Retry
// ---------------------------------------------------------------------------

describe('Subscribers — 5xx error and retry', () => {
  it('renders an inline error with a Retry button on 500', async () => {
    server.use(categoriesHandler(), errorListHandler());

    renderWithProviders(<SubscribersTree />, {
      routerProps: { initialEntries: ['/subscribers'] },
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
      http.get('/api/subscribers', () => {
        callCount += 1;
        if (callCount === 1) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json(ROWS, { status: 200 });
      }),
    );

    renderWithProviders(<SubscribersTree />, {
      routerProps: { initialEntries: ['/subscribers'] },
    });

    const retry = await screen.findByRole('button', { name: /retry/i });
    await user.click(retry);

    await waitFor(() => {
      expect(screen.getAllByTestId('subscriber-row').length).toBeGreaterThan(0);
    });
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});
