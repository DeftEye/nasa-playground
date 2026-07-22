import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NasaClientService } from '../common';

/**
 * Shape of the `/api/nasa/health` response body (architecture §4 /
 * VAL-CROSS-012). `status` is `'ok'` when the DB is reachable (200 path) and
 * `'down'` when the DB is unreachable (503 path). `nasaReachable` reflects
 * whether the NASA APOD endpoint responded within the probe timeout.
 */
export interface NasaHealthResponse {
  status: 'ok' | 'down';
  db: 'up' | 'down';
  nasaReachable: boolean;
}

/**
 * Probe timeout for the NASA reachability check. Kept short so the health
 * endpoint stays responsive even when NASA is slow / unreachable; the EONET
 * 30 s and APOD 15 s timeouts are for ingestion, not health probes.
 */
const NASA_PROBE_TIMEOUT_MS = 5_000;

/**
 * Health probe service for the NASA module. Pings Postgres (via a `SELECT 1`)
 * and NASA (via a lightweight APOD fetch) and reports reachability. The DB
 * check is authoritative for the HTTP status code: 200 when up, 503 when down.
 * NASA reachability is informational and never flips a 200 to a 503.
 */
@Injectable()
export class NasaHealthService {
  private readonly logger = new Logger(NasaHealthService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly nasaClient: NasaClientService,
  ) {}

  /**
   * Probes DB + NASA reachability. Returns the health body and whether the
   * caller should respond 200 (DB up) or 503 (DB down). NASA probe failures
   * are swallowed and reported as `nasaReachable: false`.
   */
  async probe(): Promise<{ body: NasaHealthResponse; dbUp: boolean }> {
    let dbUp = false;
    try {
      await this.dataSource.query('SELECT 1');
      dbUp = true;
    } catch (err) {
      this.logger.warn(`Health DB probe failed: ${(err as Error).message}`);
      dbUp = false;
    }

    let nasaReachable = false;
    if (dbUp) {
      try {
        await this.nasaClient.getApod(undefined, NASA_PROBE_TIMEOUT_MS);
        nasaReachable = true;
      } catch (err) {
        this.logger.warn(`Health NASA probe failed: ${(err as Error).message}`);
        nasaReachable = false;
      }
    }

    return {
      dbUp,
      body: {
        status: dbUp ? 'ok' : 'down',
        db: dbUp ? 'up' : 'down',
        nasaReachable,
      },
    };
  }
}
