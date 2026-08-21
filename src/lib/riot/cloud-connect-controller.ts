import "server-only";

import { parseRiotRegion } from "@/src/lib/riot/account-config";
import type {
  CloudBrowserService,
  CloudBrowserViewport,
} from "@/src/lib/riot/cloud-browser-service";
import type { CloudConnectionStore } from "@/src/lib/riot/cloud-connection-store";
import type { RiotConnectIdentity } from "@/src/lib/riot/connect-allowlist";
import type { RiotConnectionService } from "@/src/lib/riot/connection-service";
import { CloudBrowserSessionProvider } from "@/src/lib/riot/session-provider";
import type { RiotCloudConnectionState } from "@/src/types/database";

type SafeCloudConnection = {
  readonly account?: {
    readonly gameName: string;
    readonly region: string;
    readonly tagLine: string;
  };
  readonly captchaObserved: boolean;
  readonly expiresAt: string;
  readonly failureCode: string | null;
  readonly id: string;
  readonly mfaRequested: boolean;
  readonly state: RiotCloudConnectionState;
  readonly streamUrl?: string;
};

type StorefrontValidation = (
  userId: string,
  connectionId: string,
) => Promise<{ readonly ran: boolean }>;

const activeStates: readonly RiotCloudConnectionState[] = [
  "created",
  "starting_browser",
  "waiting_for_user",
  "authenticating",
];

function safe(row: {
  captcha_observed: boolean;
  expires_at: string;
  failure_code: string | null;
  id: string;
  mfa_requested: boolean;
  state: RiotCloudConnectionState;
}, streamUrl?: string, account?: SafeCloudConnection["account"]): SafeCloudConnection {
  return {
    ...(account ? { account } : {}),
    captchaObserved: row.captcha_observed,
    expiresAt: row.expires_at,
    failureCode: row.failure_code,
    id: row.id,
    mfaRequested: row.mfa_requested,
    state: row.state,
    ...(streamUrl ? { streamUrl } : {}),
  };
}

export class CloudConnectController {
  constructor(
    private readonly store: CloudConnectionStore,
    private readonly browser: CloudBrowserService,
    private readonly connection: Pick<RiotConnectionService, "connectCaptured">,
    private readonly validateStorefront: StorefrontValidation,
    private readonly provider = new CloudBrowserSessionProvider(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: {
    readonly connectionId?: string | null;
    readonly identity: RiotConnectIdentity;
    readonly label?: string | null;
    readonly region?: string;
    readonly viewport: CloudBrowserViewport;
  }): Promise<SafeCloudConnection> {
    const row = await this.store.create({
      connectionId: input.connectionId,
      label: input.label,
      region: parseRiotRegion(input.region),
      userId: input.identity.userId,
    });

    let providerSessionId: string | undefined;
    try {
      await this.store.updateOwned(row.id, input.identity.userId, {
        state: "starting_browser",
      }, ["created"]);
      const created = await this.browser.createSession({
        connectionSessionId: row.id,
        expiresAt: row.expires_at,
        viewport: input.viewport,
      });
      providerSessionId = created.providerSessionId;
      const attached = await this.store.attachProvider(
        row.id,
        input.identity.userId,
        providerSessionId,
      );
      return safe(attached, created.streamUrl);
    } catch {
      if (providerSessionId) {
        await this.destroy(providerSessionId);
      }
      const failed = await this.store.updateOwned(row.id, input.identity.userId, {
        failure_code: "browser_unavailable",
        state: "failed",
      });
      return safe(failed);
    }
  }

  async status(id: string, identity: RiotConnectIdentity): Promise<SafeCloudConnection | null> {
    let row = await this.store.loadOwned(id, identity.userId);
    if (!row) {
      return null;
    }
    if (Date.parse(row.expires_at) <= this.now().getTime() && activeStates.includes(row.state)) {
      if (row.provider_session_id) {
        await this.destroy(row.provider_session_id);
      }
      row = await this.store.updateOwned(id, identity.userId, {
        destroyed_at: this.now().toISOString(),
        failure_code: "expired",
        state: "expired",
      });
      return safe(row);
    }
    if (!activeStates.includes(row.state) || !row.provider_session_id) {
      return safe(row);
    }

    const providerStatus = await this.browser.getStatus(row.provider_session_id);
    if (providerStatus.state === "captured") {
      return this.capture(row.id, identity);
    }

    const state: RiotCloudConnectionState =
      providerStatus.state === "expired"
        ? "expired"
        : providerStatus.state === "failed"
          ? "failed"
          : providerStatus.state === "authenticating"
            ? "authenticating"
            : providerStatus.state === "starting"
              ? "starting_browser"
              : "waiting_for_user";
    if ((state === "failed" || state === "expired") && row.provider_session_id) {
      await this.destroy(row.provider_session_id);
    }
    row = await this.store.updateOwned(id, identity.userId, {
      captcha_observed: providerStatus.captchaObserved,
      failure_code:
        state === "expired"
          ? "expired"
          : state === "failed"
            ? "browser_unavailable"
            : null,
      last_heartbeat_at: this.now().toISOString(),
      ...((state === "failed" || state === "expired")
        ? { destroyed_at: this.now().toISOString() }
        : {}),
      mfa_requested: providerStatus.mfaRequested,
      state,
    });
    const streamUrl = activeStates.includes(state)
      ? await this.browser.getStream(row.provider_session_id!)
      : undefined;
    return safe(row, streamUrl);
  }

  async cancel(id: string, identity: RiotConnectIdentity): Promise<SafeCloudConnection | null> {
    const row = await this.store.loadOwned(id, identity.userId);
    if (!row) {
      return null;
    }
    if (!activeStates.includes(row.state)) {
      return safe(row);
    }
    if (row.provider_session_id) {
      await this.destroy(row.provider_session_id);
    }
    const cancelled = await this.store.updateOwned(id, identity.userId, {
      destroyed_at: this.now().toISOString(),
      state: "cancelled",
    });
    return safe(cancelled);
  }

  private async capture(id: string, identity: RiotConnectIdentity): Promise<SafeCloudConnection> {
    let row = await this.store.claimCapture(id, identity.userId);
    if (!row) {
      const existing = await this.store.loadOwned(id, identity.userId);
      if (!existing) {
        throw new Error("Cloud connection session disappeared.");
      }
      return safe(existing);
    }

    try {
      const cookies = await this.browser.captureCookies(row.provider_session_id!);
      const captured = await this.provider.capture({ cookies });
      row = await this.store.updateOwned(id, identity.userId, {
        state: "validating_session",
      }, ["capturing_session"]);
      const connected = await this.connection.connectCaptured({
        connectionId: row.target_connection_id,
        consentGranted: true,
        identity,
        label: row.label,
        region: row.region,
        session: captured,
      });
      await this.store.updateOwned(id, identity.userId, {
        target_connection_id: connected.connectionId,
        validation_succeeded: true,
      });
      const storefront = await this.validateStorefront(
        identity.userId,
        connected.connectionId,
      );
      if (!storefront.ran) {
        throw new Error("Storefront validation failed.");
      }
      row = await this.store.updateOwned(id, identity.userId, {
        consumed_at: this.now().toISOString(),
        state: "connected",
        storefront_succeeded: true,
      }, ["validating_session"]);
      return safe(
        row,
        undefined,
        connected.riotId
          ? {
              gameName: connected.riotId.gameName,
              region: connected.region,
              tagLine: connected.riotId.tagLine,
            }
          : undefined,
      );
    } catch (error) {
      row = await this.store.updateOwned(id, identity.userId, {
        failure_code:
          error instanceof Error && error.message === "Storefront validation failed."
            ? "storefront_failed"
            : "validation_failed",
        state: "failed",
      });
      return safe(row);
    } finally {
      if (row.provider_session_id) {
        await this.destroy(row.provider_session_id);
        try {
          await this.store.updateOwned(id, identity.userId, {
            destroyed_at: this.now().toISOString(),
          });
        } catch {
          // The browser has already been destroyed; diagnostics are best effort.
        }
      }
    }
  }

  private async destroy(providerSessionId: string): Promise<void> {
    try {
      await this.browser.destroySession(providerSessionId);
    } catch {
      // Destruction is idempotent and may race provider-side expiry.
    }
  }
}
