/**
 * Shared types mirroring backend DTOs and entity response shapes.
 *
 * These types are the contract between the frontend and the NestJS API.
 * They mirror the response shapes of the controllers in `src/` (backend),
 * NOT the raw entity columns (some fields like `passwordHash` are never
 * exposed; some like `discordWebhookUrl` are redacted/omitted in list
 * responses).
 */

// ---------------------------------------------------------------------------
// Auth (src/auth/)
// ---------------------------------------------------------------------------

export interface PublicUser {
  id: string;
  email: string;
  createdAt: string; // ISO-8601 from backend Date serialization
}

export interface LoginResult {
  accessToken: string;
  user: PublicUser;
}

export interface RegisterPayload {
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

// ---------------------------------------------------------------------------
// APOD (src/nasa/apod/)
// ---------------------------------------------------------------------------

export type ApodMediaType = 'image' | 'video' | 'other';

export interface ApodEntry {
  date: string; // YYYY-MM-DD
  title: string;
  explanation: string;
  url: string;
  mediaType: ApodMediaType;
  videoUrl: string | null;
  copyright: string | null;
  fetchedAt: string; // ISO-8601
}

export interface ApodListResponse {
  data: ApodEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface ApodListParams {
  page?: number;
  limit?: number;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// EONET (src/nasa/eonet/)
// ---------------------------------------------------------------------------

export type EonetStatus = 'open' | 'closed';

export interface EonetCategory {
  id: string; // slug, e.g. "severeStorms"
  title: string;
  description: string | null;
}

export type EonetGeometryPoint = Record<string, unknown>;

export interface EonetEvent {
  id: string; // e.g. "EONET_21437"
  title: string;
  description: string | null;
  link: string;
  status: EonetStatus;
  closedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  geometry: EonetGeometryPoint[] | null;
}

export interface EonetEventListResponse {
  data: EonetEvent[];
  total: number;
  page: number;
  limit: number;
}

export interface EonetEventListParams {
  category?: string;
  status?: EonetStatus;
  page?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Subscribers (src/subscribers/)
// ---------------------------------------------------------------------------

export interface PublicSubscriber {
  id: string;
  name: string;
  apodEnabled: boolean;
  enabled: boolean;
  eonetCategorySlugs: string[];
  createdAt: string;
}

export interface CreateSubscriberPayload {
  name: string;
  discordWebhookUrl: string;
  apodEnabled?: boolean;
  enabled?: boolean;
  eonetCategorySlugs: string[];
}

export interface UpdateSubscriberPayload {
  name?: string;
  discordWebhookUrl?: string;
  apodEnabled?: boolean;
  enabled?: boolean;
  eonetCategorySlugs?: string[] | null;
}

export interface TestNotificationResult {
  id: string;
}

// ---------------------------------------------------------------------------
// Notifications (src/notifications/)
// ---------------------------------------------------------------------------

export type NotificationSource = 'apod' | 'eonet' | 'test';
export type NotificationStatus = 'sent' | 'mocked' | 'failed';

export interface PublicNotification {
  id: string;
  deliveredAt: string; // ISO-8601
  source: NotificationSource;
  referenceId: string;
  subscriberId: string;
  status: NotificationStatus;
  payload: Record<string, unknown>;
  error: string | null;
}

export interface NotificationListParams {
  source?: NotificationSource;
  status?: NotificationStatus;
  page?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Triggers (src/nasa/*/trigger controllers)
// ---------------------------------------------------------------------------

export interface EonetFetchResult {
  detected: string[];
  updated: string[];
  skipped: string[];
  unchanged: string[];
}
