import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { fetchEonetCategories } from '../api/eonet';
import {
  createSubscriber,
  deleteSubscriber,
  fetchSubscribers,
  sendTestNotification,
  updateSubscriber,
} from '../api/subscribers';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import type {
  EonetCategory,
  NotificationStatus,
  PublicSubscriber,
} from '../types';

/**
 * Subscribers CRUD page (architecture §6 / VAL-FE-SUB-001..010,
 * VAL-CROSS-009).
 *
 * Features:
 * - List the authenticated user's subscribers with a masked webhook URL per
 *   row (`/webhooks/.../<last-4>`) — the raw Discord URL is never in the DOM
 *   (VAL-FE-SUB-004).
 * - Add form: name + Discord webhook URL + EONET category checkboxes +
 *   `apodEnabled` toggle. Client-side field validation rejects empty name,
 *   empty webhook URL, and a non-URL `discordWebhookUrl` with field-level
 *   errors and NO API call (VAL-FE-SUB-002 / VAL-FE-SUB-008).
 * - Edit in place: each row toggles into an edit form; PATCH updates name +
 *   categories without a full reload (VAL-FE-SUB-005).
 * - Delete with a confirmation modal — cancel does NOT send DELETE; confirm
 *   sends DELETE and removes the row (VAL-FE-SUB-006).
 * - "Send test" button per row: POST /api/subscribers/:id/test-notification.
 *   The HTTP response is always 2xx; the returned `status` (`sent` |
 *   `mocked` | `failed`) drives an inline success/failure indicator
 *   (VAL-FE-SUB-007 / VAL-FE-SUB-009). The created log row appears on
 *   `/notifications` (validated there).
 *
 * Cross-page UX policy:
 * - Loading skeleton while the subscribers query is pending
 *   (VAL-FE-SUB-010).
 * - Empty state when the user has no subscribers, with the add form visible
 *   (VAL-FE-SUB-001).
 * - Inline error + Retry on 5xx / network failure.
 */

const SUBSCRIBERS_KEY = ['subscribers'] as const;

// Client-side URL validation: accepts http(s) URLs. The backend's class-validator
// `@IsUrl()` is the authority, but we avoid a round-trip for obvious non-URLs
// like `not-a-url` (VAL-FE-SUB-002).
const URL_REGEX = /^https?:\/\/[^\s]+$/i;

interface FieldErrors {
  name?: string;
  discordWebhookUrl?: string;
}

/** Per-row UI state for the send-test button outcome. */
interface TestState {
  status: NotificationStatus;
  error?: string;
}

export function Subscribers() {
  const queryClient = useQueryClient();

  const subscribersQuery = useQuery({
    queryKey: SUBSCRIBERS_KEY,
    queryFn: fetchSubscribers,
  });

  const categoriesQuery = useQuery({
    queryKey: ['eonet', 'categories'],
    queryFn: fetchEonetCategories,
    staleTime: 60_000,
  });

  const categories: EonetCategory[] = categoriesQuery.data ?? [];

  // ----- Mutations (invalidate the list on success) -----
  // `createSuccessCount` increments on each successful create so the
  // AddSubscriberForm can reset its fields only on success (M5 polish:
  // keep user input on failed create, only reset on success).
  const [createSuccessCount, setCreateSuccessCount] = useState(0);

  const createMutation = useMutation({
    mutationFn: createSubscriber,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUBSCRIBERS_KEY });
      setCreateSuccessCount((c) => c + 1);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; payload: Parameters<typeof updateSubscriber>[1] }) =>
      updateSubscriber(vars.id, vars.payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SUBSCRIBERS_KEY }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSubscriber,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SUBSCRIBERS_KEY }),
  });

  const testMutation = useMutation({
    mutationFn: sendTestNotification,
  });

  // ----- UI state -----
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PublicSubscriber | null>(
    null,
  );
  // Per-subscriber send-test outcome, keyed by subscriber id.
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const [testLoadingId, setTestLoadingId] = useState<string | null>(null);

  // ----- Loading skeleton (VAL-FE-SUB-010) -----
  if (subscribersQuery.isPending) {
    return (
      <div data-testid="subscribers-skeleton" className="space-y-4">
        <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <Skeleton rows={3} />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
            >
              <Skeleton rows={2} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ----- 5xx / network error with Retry -----
  if (subscribersQuery.isError) {
    return (
      <ErrorState
        message="We couldn't load your subscribers. Please try again."
        onRetry={() => subscribersQuery.refetch()}
      />
    );
  }

  const subscribers: PublicSubscriber[] = subscribersQuery.data;

  async function handleSendTest(subscriber: PublicSubscriber) {
    setTestLoadingId(subscriber.id);
    // Clear any previous outcome for this row.
    setTestStates((prev) => {
      const next = { ...prev };
      delete next[subscriber.id];
      return next;
    });
    try {
      const result = await testMutation.mutateAsync(subscriber.id);
      setTestStates((prev) => ({
        ...prev,
        [subscriber.id]: { status: result.status },
      }));
      // Invalidate notifications so /notifications reflects the new log row.
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err) {
      // The endpoint is 2xx even on delivery failure, but a network/5xx
      // error surfaces here. Show a failed indicator with the message.
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ??
        (err as Error)?.message ??
        'Test notification request failed.';
      setTestStates((prev) => ({
        ...prev,
        [subscriber.id]: { status: 'failed', error: message },
      }));
    } finally {
      setTestLoadingId(null);
    }
  }

  return (
    <div data-testid="subscribers-page">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Subscribers
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Manage your Discord notification subscribers.
        </p>
      </header>

      {/* Add form — always visible (VAL-FE-SUB-001: empty state shows the
          add form alongside the empty-state message). */}
      <AddSubscriberForm
        categories={categories}
        creating={createMutation.isPending}
        onSubmit={(payload) => createMutation.mutate(payload)}
        submitError={createMutation.error ? 'Could not create subscriber.' : null}
        resetSignal={createSuccessCount}
      />

      {/* Subscribers list. */}
      {subscribers.length === 0 ? (
        <EmptyState
          variant="zero"
          message="No subscribers yet"
          description="Add your first subscriber using the form above."
        />
      ) : (
        <ul className="mt-6 space-y-3" data-testid="subscribers-list">
          {subscribers.map((subscriber) => (
            <SubscriberRow
              key={subscriber.id}
              subscriber={subscriber}
              categories={categories}
              editing={editingId === subscriber.id}
              onEdit={() => setEditingId(subscriber.id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={(payload) =>
                updateMutation.mutate(
                  { id: subscriber.id, payload },
                  {
                    onSuccess: () => setEditingId(null),
                  },
                )
              }
              saving={updateMutation.isPending}
              onDelete={() => setPendingDelete(subscriber)}
              onSendTest={() => handleSendTest(subscriber)}
              sendingTest={testLoadingId === subscriber.id}
              testState={testStates[subscriber.id]}
            />
          ))}
        </ul>
      )}

      {/* Delete confirmation modal (VAL-FE-SUB-006). */}
      {pendingDelete && (
        <DeleteConfirmModal
          subscriber={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const id = pendingDelete.id;
            setPendingDelete(null);
            deleteMutation.mutate(id);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-subscriber form
// ---------------------------------------------------------------------------

interface AddSubscriberFormProps {
  categories: EonetCategory[];
  creating: boolean;
  submitError: string | null;
  onSubmit: (payload: {
    name: string;
    discordWebhookUrl: string;
    apodEnabled: boolean;
    eonetCategorySlugs: string[];
  }) => void;
  /** Increments on successful create; the form watches this to reset fields
   * only on success (M5 polish: keeps user input on failed create). */
  resetSignal: number;
}

function AddSubscriberForm({
  categories,
  creating,
  submitError,
  onSubmit,
  resetSignal,
}: AddSubscriberFormProps) {
  const [name, setName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [apodEnabled, setApodEnabled] = useState(true);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Reset form fields only when the parent signals a successful create
  // (M5 polish: keeps user input on failed create, only resets on success).
  // The `resetSignal` counter increments on each successful create.
  useEffect(() => {
    if (resetSignal > 0) {
      setName('');
      setWebhookUrl('');
      setApodEnabled(true);
      setSelectedSlugs([]);
      setFieldErrors({});
    }
  }, [resetSignal]);

  function toggleSlug(slug: string) {
    setSelectedSlugs((prev) =>
      prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [...prev, slug],
    );
  }

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!name.trim()) {
      errs.name = 'Name is required.';
    }
    if (!webhookUrl.trim()) {
      errs.discordWebhookUrl = 'Discord webhook URL is required.';
    } else if (!URL_REGEX.test(webhookUrl.trim())) {
      errs.discordWebhookUrl = 'Enter a valid Discord webhook URL.';
    }
    return errs;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      // Field-level validation prevents the API call (VAL-FE-SUB-002 /
      // VAL-FE-SUB-008).
      return;
    }
    onSubmit({
      name: name.trim(),
      discordWebhookUrl: webhookUrl.trim(),
      apodEnabled,
      eonetCategorySlugs: selectedSlugs,
    });
    // Form reset is handled by the `resetSignal` effect which fires only
    // on successful create (M5 polish: keeps user input on failed create).
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Add subscriber form"
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
      data-testid="add-subscriber-form"
    >
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
        Add a subscriber
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="sub-name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Name
          </label>
          <input
            id="sub-name"
            name="name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (fieldErrors.name)
                setFieldErrors((p) => ({ ...p, name: undefined }));
            }}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? 'sub-name-error' : undefined}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            placeholder="My Discord channel"
            data-testid="sub-name-input"
          />
          {fieldErrors.name && (
            <p
              id="sub-name-error"
              role="alert"
              className="mt-1 text-sm text-red-600 dark:text-red-400"
              data-testid="sub-name-error"
            >
              {fieldErrors.name}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="sub-webhook"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Discord webhook URL
          </label>
          <input
            id="sub-webhook"
            name="discordWebhookUrl"
            type="url"
            value={webhookUrl}
            onChange={(e) => {
              setWebhookUrl(e.target.value);
              if (fieldErrors.discordWebhookUrl)
                setFieldErrors((p) => ({ ...p, discordWebhookUrl: undefined }));
            }}
            aria-invalid={Boolean(fieldErrors.discordWebhookUrl)}
            aria-describedby={
              fieldErrors.discordWebhookUrl
                ? 'sub-webhook-error'
                : undefined
            }
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            placeholder="https://discord.com/api/webhooks/…"
            data-testid="sub-webhook-input"
          />
          {fieldErrors.discordWebhookUrl && (
            <p
              id="sub-webhook-error"
              role="alert"
              className="mt-1 text-sm text-red-600 dark:text-red-400"
              data-testid="sub-webhook-error"
            >
              {fieldErrors.discordWebhookUrl}
            </p>
          )}
        </div>
      </div>

      {/* EONET category checkboxes (VAL-FE-SUB-003). */}
      <fieldset>
        <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
          EONET categories
        </legend>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Select none to receive all EONET events; select specific categories to
          filter.
        </p>
        <div
          className="mt-2 flex flex-wrap gap-3"
          data-testid="sub-category-checkboxes"
        >
          {categories.length === 0 && (
            <span className="text-xs text-gray-400">No categories loaded.</span>
          )}
          {categories.map((c) => (
            <label
              key={c.id}
              className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
            >
              <input
                type="checkbox"
                checked={selectedSlugs.includes(c.id)}
                onChange={() => toggleSlug(c.id)}
                data-testid="sub-category-checkbox"
                data-category={c.id}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              {c.title}
            </label>
          ))}
        </div>
      </fieldset>

      {/* apodEnabled toggle (VAL-FE-SUB-003). */}
      <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input
          type="checkbox"
          checked={apodEnabled}
          onChange={(e) => setApodEnabled(e.target.checked)}
          data-testid="sub-apod-toggle"
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        Receive APOD notifications
      </label>

      {submitError && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
          data-testid="add-subscriber-submit-error"
        >
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={creating}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="add-subscriber-submit"
      >
        {creating ? 'Adding…' : 'Add subscriber'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Subscriber row (display + edit-in-place)
// ---------------------------------------------------------------------------

interface SubscriberRowProps {
  subscriber: PublicSubscriber;
  categories: EonetCategory[];
  editing: boolean;
  saving: boolean;
  sendingTest: boolean;
  testState?: TestState;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (payload: {
    name?: string;
    apodEnabled?: boolean;
    eonetCategorySlugs?: string[];
  }) => void;
  onDelete: () => void;
  onSendTest: () => void;
}

function SubscriberRow({
  subscriber,
  categories,
  editing,
  saving,
  sendingTest,
  testState,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onSendTest,
}: SubscriberRowProps) {
  if (editing) {
    return (
      <EditSubscriberForm
        subscriber={subscriber}
        categories={categories}
        saving={saving}
        onCancel={onCancelEdit}
        onSave={onSave}
      />
    );
  }

  return (
    <li
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
      data-testid="subscriber-row"
      data-subscriber-id={subscriber.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Name rendered as TEXT (architecture §6 security). */}
          <h2
            className="truncate text-base font-semibold text-gray-900 dark:text-gray-100"
            data-testid="subscriber-name"
          >
            {subscriber.name}
          </h2>
          {/* Masked webhook URL — raw URL never in the DOM (VAL-FE-SUB-004). */}
          <p
            className="mt-0.5 font-mono text-xs text-gray-500 dark:text-gray-400"
            data-testid="subscriber-masked-webhook"
          >
            {subscriber.maskedWebhookUrl}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            data-testid="subscriber-edit-btn"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onSendTest}
            disabled={sendingTest}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            data-testid="subscriber-send-test-btn"
          >
            {sendingTest ? 'Sending…' : 'Send test'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:bg-gray-800 dark:text-red-300 dark:hover:bg-red-900/30"
            data-testid="subscriber-delete-btn"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Category + flag chips. */}
      <div
        className="mt-3 flex flex-wrap items-center gap-2"
        data-testid="subscriber-meta"
      >
        {subscriber.apodEnabled && (
          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
            APOD
          </span>
        )}
        {subscriber.eonetCategorySlugs.length === 0 ? (
          <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900/40 dark:text-purple-200">
            All EONET categories
          </span>
        ) : (
          subscriber.eonetCategorySlugs.map((slug) => (
            <span
              key={slug}
              className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200"
              data-testid="subscriber-category-chip"
            >
              {slug}
            </span>
          ))
        )}
        {!subscriber.enabled && (
          <span className="inline-flex items-center rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-600 dark:text-gray-100">
            disabled
          </span>
        )}
      </div>

      {/* Send-test outcome (VAL-FE-SUB-007 / VAL-FE-SUB-009). */}
      {testState && (
        <div
          className="mt-3"
          data-testid="subscriber-test-result"
          data-test-status={testState.status}
        >
          {testState.status === 'failed' ? (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
              data-testid="subscriber-test-failed"
            >
              Test notification failed
              {testState.error ? `: ${testState.error}` : ''}.
            </p>
          ) : (
            <p
              className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300"
              data-testid="subscriber-test-success"
            >
              Test notification sent (status: {testState.status}).
            </p>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Edit-subscriber form (rendered in place of the row)
// ---------------------------------------------------------------------------

interface EditSubscriberFormProps {
  subscriber: PublicSubscriber;
  categories: EonetCategory[];
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: {
    name?: string;
    apodEnabled?: boolean;
    eonetCategorySlugs?: string[];
  }) => void;
}

function EditSubscriberForm({
  subscriber,
  categories,
  saving,
  onCancel,
  onSave,
}: EditSubscriberFormProps) {
  const [name, setName] = useState(subscriber.name);
  const [apodEnabled, setApodEnabled] = useState(subscriber.apodEnabled);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>(
    subscriber.eonetCategorySlugs,
  );
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  const initial = useMemo(
    () => ({
      name: subscriber.name,
      apodEnabled: subscriber.apodEnabled,
      slugs: [...subscriber.eonetCategorySlugs].sort().join(','),
    }),
    [subscriber],
  );
  const changed =
    name !== initial.name ||
    apodEnabled !== initial.apodEnabled ||
    [...selectedSlugs].sort().join(',') !== initial.slugs;

  function toggleSlug(slug: string) {
    setSelectedSlugs((prev) =>
      prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [...prev, slug],
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setFieldError('Name is required.');
      return;
    }
    setFieldError(undefined);
    onSave({
      name: name.trim(),
      apodEnabled,
      eonetCategorySlugs: selectedSlugs,
    });
  }

  return (
    <li
      className="rounded-lg border border-blue-300 bg-white p-4 shadow-sm dark:border-blue-700 dark:bg-gray-800"
      data-testid="subscriber-edit-form"
      data-subscriber-id={subscriber.id}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Edit subscriber
        </h2>
        <div>
          <label
            htmlFor={`edit-name-${subscriber.id}`}
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Name
          </label>
          <input
            id={`edit-name-${subscriber.id}`}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (fieldError) setFieldError(undefined);
            }}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            data-testid="edit-name-input"
          />
          {fieldError && (
            <p
              role="alert"
              className="mt-1 text-sm text-red-600 dark:text-red-400"
            >
              {fieldError}
            </p>
          )}
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
            EONET categories
          </legend>
          <div
            className="mt-2 flex flex-wrap gap-3"
            data-testid="edit-category-checkboxes"
          >
            {categories.map((c) => (
              <label
                key={c.id}
                className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
              >
                <input
                  type="checkbox"
                  checked={selectedSlugs.includes(c.id)}
                  onChange={() => toggleSlug(c.id)}
                  data-testid="edit-category-checkbox"
                  data-category={c.id}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                {c.title}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={apodEnabled}
            onChange={(e) => setApodEnabled(e.target.checked)}
            data-testid="edit-apod-toggle"
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Receive APOD notifications
        </label>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving || !changed}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="edit-save-btn"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            data-testid="edit-cancel-btn"
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation modal (VAL-FE-SUB-006)
// ---------------------------------------------------------------------------

function DeleteConfirmModal({
  subscriber,
  onCancel,
  onConfirm,
}: {
  subscriber: PublicSubscriber;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
      data-testid="delete-modal-backdrop"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
        data-testid="delete-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm delete subscriber"
      >
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Delete subscriber
          </h2>
        </div>
        <div className="px-4 py-4">
          <p className="text-sm text-gray-700 dark:text-gray-200">
            Are you sure you want to delete{' '}
            <span className="font-semibold">{subscriber.name}</span>? This
            cannot be undone.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            data-testid="delete-cancel-btn"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
            data-testid="delete-confirm-btn"
          >
            Confirm delete
          </button>
        </div>
      </div>
    </div>
  );
}
