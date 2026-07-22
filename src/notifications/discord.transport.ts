import { Injectable, Logger } from '@nestjs/common';
import { Subscriber } from '../subscribers/entities/subscriber.entity';

/**
 * Outcome of a single {@link DiscordTransportService.send} call. Mirrors the
 * `notification_log.status` enum: `sent` (real 2xx), `mocked` (no HTTP call),
 * `failed` (real non-2xx or transport error). `error` is populated only on
 * `failed` and is always ≤ 500 chars (architecture §8).
 */
export interface DiscordSendResult {
  status: 'sent' | 'mocked' | 'failed';
  error: string | null;
}

/**
 * Discord webhook transport.
 *
 * - **Mock mode** (default, `DISABLE_NOTIFICATION_MOCK` unset or not `'true'`):
 *   records the call by returning `status='mocked'` WITHOUT making any HTTP
 *   request. The caller writes the `notification_log` row.
 * - **Real mode** (`DISABLE_NOTIFICATION_MOCK === 'true'`): issues exactly ONE
 *   POST to `subscriber.discordWebhookUrl` with `{content, embeds?}`. 2xx →
 *   `sent`; non-2xx → `failed` with the response body truncated to 500 chars;
 *   network/transport error → `failed` with the error message truncated to
 *   500 chars.
 *
 * **No transport-level retry** (architecture §12 / VAL-NOTIF-013): each
 * subscriber receives exactly one POST per fan-out invocation. The outcome is
 * captured in a single `notification_log` row written by the caller.
 *
 * The transport NEVER throws — failures are captured and returned so the
 * scheduler / trigger request thread is never crashed (VAL-NOTIF-008).
 *
 * Uses the global `fetch` (Node 24 native, intercepted by `nock` 14 in tests).
 */
@Injectable()
export class DiscordTransportService {
  private readonly logger = new Logger(DiscordTransportService.name);

  async send(
    subscriber: Subscriber,
    payload: Record<string, unknown>,
  ): Promise<DiscordSendResult> {
    if (process.env.DISABLE_NOTIFICATION_MOCK !== 'true') {
      return { status: 'mocked', error: null };
    }

    try {
      const res = await fetch(subscriber.discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: payload.content,
          embeds: payload.embeds,
        }),
      });
      if (res.status >= 200 && res.status < 300) {
        return { status: 'sent', error: null };
      }
      const body = await res.text().catch(() => '');
      return {
        status: 'failed',
        error: `Discord responded ${res.status}: ${body}`.slice(0, 500),
      };
    } catch (err) {
      const message = (err as Error)?.message ?? 'unknown transport error';
      this.logger.warn(
        `Discord webhook POST failed for subscriber ${subscriber.id}: ${message}`,
      );
      return { status: 'failed', error: message.slice(0, 500) };
    }
  }
}
