import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Credentials outlive any single call (capped at 30 min); a rejoin fetches fresh ones. */
const TURN_TTL_SECONDS = 4 * 60 * 60;

/**
 * ICE servers for WebRTC.
 *
 * STUN alone fails when either side is behind a strict NAT or firewall (common on corporate
 * networks and mobile carriers). With a Cloudflare TURN key configured, each user gets
 * short-lived TURN credentials generated server-side, so no long-lived relay password ships
 * to the browser. If the TURN API is unreachable we fall back to STUN instead of failing the call.
 */
@Injectable()
export class IceServersService {
  private readonly logger = new Logger(IceServersService.name);

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async get(): Promise<IceServer[]> {
    const { TURN_KEY_ID: keyId, TURN_KEY_API_TOKEN: token } = this.cfg;
    const fallback = this.cfg.ICE_SERVERS as IceServer[];
    if (!keyId || !token) return fallback;

    try {
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { iceServers: IceServer | IceServer[] };
      const servers = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
      // Some browsers reject TURN URLs on port 53; drop them if the provider ever returns any.
      return servers.map((s) => ({
        ...s,
        urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)),
      }));
    } catch (e) {
      this.logger.warn(`TURN credentials unavailable, falling back to STUN: ${(e as Error).message}`);
      return fallback;
    }
  }
}
