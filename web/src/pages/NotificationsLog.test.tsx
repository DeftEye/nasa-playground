import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../test/render';
import { NotificationsLog } from './NotificationsLog';
import { server } from '../test/server';
import type { PublicNotification } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Three rows ordered newest-first (deliveredAt DESC), as the backend returns
 * them (VAL-FE-NOTIF-005). jsdom runs in UTC, so `formatLocalIso` produces
 * the `YYYY-MM-DDTHH:MM:SS` form below.
 */
const ROWS: PublicNotification[] = [
  {
    id: 'n3',
    deliveredAt: '2025-07-22T18:00:00.000Z',
    source: 'apod',
    referenceId: '2025-07-22',
    subscriberId: 'sub-1',
    status: 'sent',
    payload: {
      content: 'New APOD: Andromeda',
      subscriberId: 'sub-1',
      webhookUrl: '/webhooks/.../abcd',
    },
    error: null,
  },
  {
    id: 'n2',
    deliveredAt: '2025-07-22T12:00:00.000Z',
    source: 'eonet',
    referenceId: 'EONET_999',
    subscriberId: 'sub-1',
    status: 'mocked',
    payload: {
      content: 'EONET event: Storm',
      subscriberId: 'sub-1',
      webhookUrl: '/webhooks/.../abcd',
    },
    error: null,
  },
  {
    id: 'n1',
    deliveredAt: '2025-07-22T09:00:00.000Z',
    source: 'test',
    referenceId: 'test',
    subscriberId: 'sub-2',
    status: 'failed',
    payload: {
      content: 'Test notification',
      subscriberId: 'sub-2',
      webhookUrl: '/webhooks/.../wxyz',
    },
    error: 'Discord responded 500: boom',
  },
];

function listHandler(rows: PublicNotification[] = ROWS) {
  return http.get('/api/notifications', ({ request }) => {
    const url = new URL(request.url);
    const source = url.searchParams.get('source') ?? undefined;
    const status = url.searchParams.get('status') ?? undefined;
    const filtered = rows.filter(
      (r) =>
        (!source || r.source === source) &&
        (!status || r.status === status),
    );
    return HttpResponse.json(filtered, { status: 200 });
  });
}

function emptyListHandler() {
  return http.get('/api/notifications', () => HttpResponse.json([], { status: 200 }));
}

function errorListHandler() {
  return http.get('/api/notifications', () =>
    HttpResponse.json({ message: 'boom' }, { status: 500 }),
  );
}

function delayedListHandler(rows: PublicNotification[] = ROWS, ms = 500) {
  return http.get('/api/notifications', async () => {
    await delay(ms);
    return HttpResponse.json(rows, { status: 200 });
  });
}

function NotifTree() {
  return (
    <Routes>
      <Route path="/notifications" element={<NotificationsLog />} />
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
// VAL-FE-NOTIF-001: required columns in order
// ---------------------------------------------------------------------------

describe('NotificationsLog — VAL-FE-NOTIF-001 columns', () => {
  it('renders the five required columns in the declared order', async () => {
    server.use(listHandler());

    renderWithProviders(<NotifTree />, {
      routerProps: { initialEntries: ['/notifications'] },
    });

    const headers = await screen.findAllByText(/^(deliveredAt|source|subscriberId|referenceId|status)$/);
    const headerTexts = headers.map((h) => h.textContent);
    expect(headerTexts).toEqual([
      'deliveredAt',
      'source',
      'subscriberId',
      'referenceId',
      'status',
    ]);
  });

  it('renders rows and fires GET /api/notifications', async () => {
    server.use(listHandler());

    renderWithProviders(<NotifTree />, {
      routerProps: { initialEntries: ['/notifications'] },
    });

    const rows = await screen.findAllByTestId('notif-row');
    expect(rows).toHaveLength(ROWS.length);
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-NOTIF-002: status filter refreshes the table
// ---------------------------------------------------------------------------

describe('NotificationsLog — VAL-FE-NOTIF-002 status filter', () => {
  it('switching status all→sent→mocked→failed sends ?status and updates rows', async () => {
    const capturedUrls: string[] = [];
    server.use(
      http.get('/api/notifications', ({ request }) => {
        capturedUrls.push(request.url);
        const url = new URL(request.url);
        const status = url.searchParams.get('status') ?? undefined;
        const filtered = ROWS.filter((r) => !status || r.status === status);
        return HttpResponse.json(filtered, { status: 200 });
      }),
    );

    renderWithProviders(<NotifTree />, {
      routerProps: { initialEntries: ['/notifications'] },
    });

    await screen.findAllByTestId('notif-row');
    // First (initial) request: no status param.
    expect(new URL(capturedUrls[0]).searchParams.get('status')).toBeNull();

    for (const value of ['sent', 'mocked', 'failed'] as const) {
      // Re-query the select each iteration to avoid a stale node reference
      // after the state-driven re-render.
      const select = screen.getByTestId('notif-status-filter');
      fireEvent.change(select, { target: { value } });

      await waitFor(() => {
        const last = new URL(capturedUrls[capturedUrls.length - 1]);
        expect(last.searchParams.get('status')).toBe(value);
      });
      await screen.findAllByTestId('notif-row');
      // Every visible row's status cell matches the filter.
      const statuses = screen
        .getAllByTestId('notif-cell-status')
        .map((s) => s.textContent);
      expect(statuses.every((s) => s === value)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-NOTIF-003: clicking a row opens a payload modal; close returns to table
// ---------------------------------------------------------------------------

describe('NotificationsLog — VAL-FE-NOTIF-003 payload modal', () => {
  it('clicking a row opens a modal with serialized JSON payload', async () => {
    const user = userEvent.setup();
    server.use(listHandler());

    renderWithProviders(<NotifTree />, {
      routerProps: { initialEntries: ['/notifications'] },
    });

    const rows = await screen.findAllByTestId('notif-row');
    await user.click(rows[0]);

    const modal = await screen.findByTestId('notif-modal');
    expect(modal).toBeInTheDocument();
    const payload = screen.getByTestId('notif-modal-payload');
    // The payload JSON is present and contains the row's content.
    expect(payload.textContent).toContain('New APOD: Andromeda');
  });

  it('closing the modal returns to the table view', async () => {
    const user = userEvent.setup();
    server.use(listHandler());

    renderWithProviders(<NotifTree />, {
      routerProps: { initialEntries: ['/notifications'] },
    });

    const rows = await screen.findAllByTestId('notif-row');
    await user.click(rows[0]);
    await screen.findByTestId('notif-modal');

    const close = screen.getByTestId('notif-modal-close');
    await user.click(close);

    await waitFor(() => {
      expect(screen.queryByTestId('notif-modal')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('notif-table')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-NOTIF-004: modal masks the Discord webhook URL
// ---------------------------------------------------------------------------

describe('NotificationsLog — VAL-FE-NOTIF-004 webhook redaction', () => {
  it('renders only the redacted webhook URL form; never the raw Discord URL', async () => {
    const user = userEvent.setup();
    server.use(listHandler());

    renderWithProviders(<NotifTree />, {
      routerProps: { initialEntries: ['/notifications'] },
    });

    const rows = await screen.findAllByTestId('notif-row');
    await user.click(rows[0]);

    const payload = await screen.findByTestId('notif-modal-payload');
    const text = payload.textContent ?? '';
    // Redacted form present.
    expect(text).toContain('/webhooks/.../abcd');
    // Raw Discord webhook URL never appears anywhere in the modal.
    expect(text).not.toContain('discord.com/api/webhooks');
    const modalText = screen.getByTestId('notif-modal').textContent ?? '';
    expect(modalText).not.toContain('discord.com/api/webhooks');
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-NOTIF-005: default sort newest-first
// ---------------------------------------------------------------------------

describe('NotificationsLog — VAL-FE-NOTIF-005 newest-first sort', () => {
  it('renders the newest row at the top by default', async () => {
    server.use(listHandler());

    renderWithProviders(<NotifTree />, {
      routerProps: { initialEntries: ['/notifications'] },
    });

    const rows = await screen.findAllByTestId('notif-row');
    // ROWS is already newest-first; the first row should be the newest (n3).
    expect(rows[0].getAttribute('data-notification-id')).toBe('n3');
    // `deliveredAt` is rendered as an ISO-8601 string in the user's *local*
    // timezone (architecture §6). Compute the expected local ISO from the
    // same Date so the assertion is timezone-agnostic.
    const expectedLocalIso = formatLocalIsoForTest(ROWS[0].deliveredAt);
    expect(
      withinRow(rows[0], 'notif-cell-deliveredAt').textContent,
    ).toContain(expectedLocalIso);
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-NOTIF-006: source filter refreshes the table
// ---------------------------------------------------------------------------

describe('NotificationsLog — VAL-FE-NOTIF-006 source filter', () => {
  it('switching source all→apod→eonet→test sends ?source and updates rows', async () => {
    const capturedUrls: string[] = [];
    server.use(
      http.get('/api/notifications', ({ request }) => {
        capturedUrls.push(request.url);
        const url = new URL(request.url);
        const source = url.searchParams.get('source') ?? undefined;
        const filtered = ROWS.filter((r) => !source || r.source === source);
        return HttpResponse.json(filtered, { status: 200 });
      }),
    );

    renderWithProviders(<NotifTree />, {
      routerProps: { initialEntries: ['/notifications'] },
    });

    await screen.findAllByTestId('notif-row');
    expect(new URL(capturedUrls[0]).searchParams.get('source')).toBeNull();

    for (const value of ['apod', 'eonet', 'test'] as const) {
      // Re-query the select each iteration to avoid a stale node reference.
      const select = screen.getByTestId('notif-source-filter');
      fireEvent.change(select, { target: { value } });

      await waitFor(() => {
        const last = new URL(capturedUrls[capturedUrls.length - 1]);
        expect(last.searchParams.get('source')).toBe(value);
      });
      await screen.findAllByTestId('notif-cell-source');
      const sources = screen
        .getAllByTestId('notif-cell-source')
        .map((s) => s.textContent);
      expect(sources.every((s) => s === value)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-NOTIF-007: loading skeleton shown until data populates
// ---------------------------------------------------------------------------

describe('NotificationsLog — VAL-FE-NOTIF-007 loading skeleton', () => {
  it('renders a skeleton while the fetch is pending, then the table', async () => {
    server.use(delayedListHandler(ROWS, 500));

    renderWithProviders(<NotifTree />, {
      routerProps: { initialEntries: ['/notifications'] },
    });

    expect(await screen.findByTestId('notif-skeleton')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByTestId('notif-row').length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('notif-skeleton')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VAL-FE-ERR-002: 5xx error state with Retry
// ---------------------------------------------------------------------------

describe('NotificationsLog — VAL-FE-ERR-002 5xx error and retry', () => {
  it('renders an inline error with a Retry button on 500', async () => {
    server.use(errorListHandler());

    renderWithProviders(<NotifTree />, {
      routerProps: { initialEntries: ['/notifications'] },
    });

    const errorState = await screen.findByTestId('error-state');
    expect(errorState).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('clicking Retry re-runs the query and renders the table', async () => {
    const user = userEvent.setup();
    let callCount = 0;
    server.use(
      http.get('/api/notifications', () => {
        callCount += 1;
        if (callCount === 1) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json(ROWS, { status: 200 });
      }),
    );

    renderWithProviders(<NotifTree />, {
      routerProps: { initialEntries: ['/notifications'] },
    });

    const retry = await screen.findByRole('button', { name: /retry/i });
    await user.click(retry);

    await waitFor(() => {
      expect(screen.getAllByTestId('notif-row').length).toBeGreaterThan(0);
    });
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Extra: empty state when the user has no notifications
// ---------------------------------------------------------------------------

describe('NotificationsLog — empty state', () => {
  it('shows an empty state when the response is an empty array', async () => {
    server.use(emptyListHandler());

    renderWithProviders(<NotifTree />, {
      routerProps: { initialEntries: ['/notifications'] },
    });

    const empty = await screen.findByTestId('empty-state');
    expect(empty).toHaveAttribute('data-variant', 'zero');
    expect(screen.queryByTestId('notif-table')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withinRow(row: HTMLElement, testId: string): HTMLElement {
  const el = row.querySelector(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`element ${testId} not found in row`);
  return el as HTMLElement;
}

/**
 * Mirrors the component's `formatLocalIso` helper so tests can assert the
 * `deliveredAt` column renders an ISO-8601 string in the user's local
 * timezone without hard-coding a timezone offset.
 */
function formatLocalIsoForTest(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
