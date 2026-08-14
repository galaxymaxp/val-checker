import "server-only";

import type { FetchedStorefront, Session } from "@/src/lib/riot/adapter";
import type { RiotConnectAllowlist } from "@/src/lib/riot/connect-allowlist";
import type { SentStorefrontNotification } from "@/src/lib/notifications/dedup";
import { reauthenticateAndPersist } from "@/src/lib/riot/reauth-persistence";
import type { SessionCheckResult } from "@/src/lib/riot/session-lifecycle";
import type { SessionStore } from "@/src/lib/riot/session-store";
import type {
  StorefrontPipelineInput,
  StorefrontPipelineResult,
} from "@/src/lib/storefront/pipeline";
import type { Database } from "@/src/types/database";

type AuthStatus = Database["public"]["Enums"]["auth_status"];

export type WorkerConnection = {
  readonly authStatus: AuthStatus;
  readonly connectionEpoch: string;
  readonly consecutiveFailures: number;
  readonly createdAt: string;
  readonly id: string;
  readonly lastRefreshAt: string | null;
  readonly region: string | null;
  readonly userId: string;
};

export type DailyRunClaim = {
  readonly claimedAt: Date;
  readonly id: string;
  readonly storeDate: string;
};

export type LifecycleApplication = {
  readonly applied: boolean;
  readonly terminalTransition: boolean;
};

export type RunLogOutcome = "checked" | "failed" | "skipped";

/**
 * Closed vocabulary. A raw error string is never recorded, so an operational
 * log line cannot leak cookies, tokens, or a PUUID.
 */
export type RunLogReason =
  | "ATTEMPT_FENCED"
  | "DAILY_CLAIM_HELD"
  | "DELIVERY_FAILED"
  | "LIFECYCLE_STALE"
  | "NOT_ALLOWLISTED"
  | "REAUTH_FAILED"
  | "REAUTH_REQUIRED_SKIP"
  | "SESSION_UNAVAILABLE"
  | "STOREFRONT_FAILED"
  | "UNEXPECTED";

export type RunLogEntry = {
  readonly classification: SessionCheckResult | null;
  readonly connectionId: string;
  readonly emailsSent: number;
  readonly matchesFound: number;
  readonly outcome: RunLogOutcome;
  readonly reason: RunLogReason | null;
  readonly runId: string | null;
  readonly storeDate: string | null;
  readonly userId: string;
};

export interface DailyStorefrontRepository {
  applyLifecycle(
    connection: WorkerConnection,
    result: SessionCheckResult,
    transientStatus: AuthStatus,
  ): Promise<LifecycleApplication>;
  claim(connection: WorkerConnection): Promise<DailyRunClaim | null>;
  listConnections(): Promise<readonly WorkerConnection[]>;
  loadSentNotifications(
    connection: WorkerConnection,
    storeDate: string,
  ): Promise<readonly SentStorefrontNotification[]>;
  loadVerifiedEmail(userId: string): Promise<string | null>;
  markStorefrontAttempt(
    claim: DailyRunClaim,
    connection: WorkerConnection,
  ): Promise<Date | null>;
  recordRun(entry: RunLogEntry): Promise<void>;
}

export interface WorkerRiotClient {
  getStore(session: Session): Promise<FetchedStorefront>;
  refreshSession(session: Session): Promise<Session>;
}

export type WorkerRiotClientFactory = (input: {
  readonly region: string | null;
  readonly session: Session;
}) => WorkerRiotClient;

export type WorkerExpirySender = (input: {
  readonly email: string;
  readonly idempotencyKey: string;
}) => Promise<void>;

export type WorkerPipeline = (
  input: StorefrontPipelineInput,
) => Promise<StorefrontPipelineResult>;

export type WorkerStorefrontDelivery = {
  readonly emailsSent: number;
};

export type WorkerStorefrontSender = (
  input: StorefrontPipelineResult & {
    readonly checkedAt: Date;
    readonly connectionId: string;
    readonly userId: string;
  },
) => Promise<WorkerStorefrontDelivery>;

export type DailyStorefrontWorkerDependencies = {
  readonly allowlist: Pick<RiotConnectAllowlist, "allows">;
  readonly createRiotClient: WorkerRiotClientFactory;
  readonly pipeline: WorkerPipeline;
  readonly repository: DailyStorefrontRepository;
  readonly sendExpiry: WorkerExpirySender;
  readonly sendStorefront: WorkerStorefrontSender;
  readonly sessionStore: Pick<SessionStore, "load" | "persistRotated">;
};

export type DailyStorefrontSummary = {
  readonly checked: number;
  readonly failed: number;
  readonly processed: number;
  readonly skipped: number;
};

type AccountResult = {
  readonly classification: SessionCheckResult | null;
  readonly emailsSent: number;
  readonly matchesFound: number;
  readonly outcome: RunLogOutcome;
  readonly reason: RunLogReason | null;
  readonly runId: string | null;
  readonly storeDate: string | null;
};

function terminated(
  outcome: RunLogOutcome,
  reason: RunLogReason | null,
  overrides: Partial<AccountResult> = {},
): AccountResult {
  return {
    classification: null,
    emailsSent: 0,
    matchesFound: 0,
    outcome,
    reason,
    runId: null,
    storeDate: null,
    ...overrides,
  };
}

function failureClassification(error: unknown): SessionCheckResult {
  if (
    typeof error === "object" &&
    error !== null &&
    "classification" in error
  ) {
    const value = (error as { readonly classification?: unknown })
      .classification;
    if (value === "DEAD" || value === "UNKNOWN" || value === "ERROR") {
      return value;
    }
  }
  return "ERROR";
}

function transientStatus(error: unknown): AuthStatus {
  if (
    typeof error === "object" &&
    error !== null &&
    "classification" in error
  ) {
    const classified = error as {
      readonly classification?: unknown;
      readonly status?: unknown;
    };
    if (classified.classification === "UNKNOWN") {
      return classified.status === 429 ? "RATE_LIMITED" : "RIOT_UNAVAILABLE";
    }
    if (classified.classification === "ERROR" && "status" in classified) {
      return "NETWORK_BLOCKED";
    }
  }
  return "RIOT_UNAVAILABLE";
}

function reconstructSession(
  connection: WorkerConnection,
  material: Uint8Array,
): Session {
  return {
    capturedAt: connection.lastRefreshAt ?? connection.createdAt,
    fixtureOnly: false,
    kind: "captured-session",
    material,
    provider: "manual-cookie",
  };
}

/**
 * Runs the daily check sequentially. Every account is isolated, and the only
 * code path that calls getStore first owns both the daily claim and attempt
 * marker for the still-current connection epoch.
 */
export class DailyStorefrontWorker {
  constructor(private readonly dependencies: DailyStorefrontWorkerDependencies) {}

  async run(): Promise<DailyStorefrontSummary> {
    const connections = await this.dependencies.repository.listConnections();
    const counts = { checked: 0, failed: 0, processed: 0, skipped: 0 };

    for (const connection of connections) {
      counts.processed += 1;
      let result: AccountResult;
      try {
        result = await this.runAccount(connection);
      } catch {
        result = terminated("failed", "UNEXPECTED");
      }
      counts[result.outcome] += 1;
      await this.recordRun(connection, result);
    }

    return counts;
  }

  private async runAccount(connection: WorkerConnection): Promise<AccountResult> {
    if (connection.authStatus === "REAUTH_REQUIRED") {
      return terminated("skipped", "REAUTH_REQUIRED_SKIP");
    }

    const email = await this.dependencies.repository.loadVerifiedEmail(
      connection.userId,
    );
    if (
      !email ||
      !this.dependencies.allowlist.allows({ email, userId: connection.userId })
    ) {
      return terminated("skipped", "NOT_ALLOWLISTED");
    }

    const claim = await this.dependencies.repository.claim(connection);
    if (!claim) {
      return terminated("skipped", "DAILY_CLAIM_HELD");
    }

    const claimed = { runId: claim.id, storeDate: claim.storeDate };
    let storefront: FetchedStorefront;
    let checkedAt: Date;
    // Narrows the closed-vocabulary reason without ever reading an error
    // message, which could otherwise carry session material.
    let phase: RunLogReason = "SESSION_UNAVAILABLE";
    try {
      const material = await this.dependencies.sessionStore.load(
        connection.userId,
        connection.connectionEpoch,
      );
      if (!material) {
        throw new Error("Current encrypted session is unavailable.");
      }

      const session = reconstructSession(connection, material);
      const client = this.dependencies.createRiotClient({
        region: connection.region,
        session,
      });
      phase = "REAUTH_FAILED";
      const rotated = await reauthenticateAndPersist({
        adapter: client,
        expectedConnectionEpoch: connection.connectionEpoch,
        session,
        store: this.dependencies.sessionStore,
        userId: connection.userId,
      });

      phase = "ATTEMPT_FENCED";
      const attemptedAt =
        await this.dependencies.repository.markStorefrontAttempt(
          claim,
          connection,
        );
      if (!attemptedAt) {
        return terminated("skipped", "ATTEMPT_FENCED", claimed);
      }
      checkedAt = attemptedAt;
      phase = "STOREFRONT_FAILED";
      storefront = await client.getStore(rotated);
    } catch (error) {
      const result = failureClassification(error);
      const lifecycle = await this.dependencies.repository.applyLifecycle(
        connection,
        result,
        transientStatus(error),
      );
      if (lifecycle.applied && lifecycle.terminalTransition) {
        await this.dependencies.sendExpiry({
          email,
          idempotencyKey: `val-checker/session-expired/${claim.id}`,
        });
      }
      return terminated("failed", phase, { ...claimed, classification: result });
    }

    const healthy = await this.dependencies.repository.applyLifecycle(
      connection,
      "OK",
      "CONNECTED",
    );
    if (!healthy.applied) {
      return terminated("skipped", "LIFECYCLE_STALE", {
        ...claimed,
        classification: "OK",
      });
    }

    let matchesFound = 0;
    try {
      const sentNotifications =
        await this.dependencies.repository.loadSentNotifications(
          connection,
          claim.storeDate,
        );
      const plan = await this.dependencies.pipeline({
        checkedAt,
        sentNotifications,
        storefront,
        userId: connection.userId,
      });
      matchesFound = plan.matches.length;
      const delivery = await this.dependencies.sendStorefront({
        ...plan,
        checkedAt,
        connectionId: connection.id,
        userId: connection.userId,
      });
      return {
        ...claimed,
        classification: "OK",
        emailsSent: delivery.emailsSent,
        matchesFound,
        outcome: "checked",
        reason: null,
      };
    } catch {
      // A valid storefront proves session health. Downstream failures are not
      // fed into the Riot session lifecycle.
      return terminated("failed", "DELIVERY_FAILED", {
        ...claimed,
        classification: "OK",
        matchesFound,
      });
    }
  }

  private async recordRun(
    connection: WorkerConnection,
    result: AccountResult,
  ): Promise<void> {
    try {
      await this.dependencies.repository.recordRun({
        classification: result.classification,
        connectionId: connection.id,
        emailsSent: result.emailsSent,
        matchesFound: result.matchesFound,
        outcome: result.outcome,
        reason: result.reason,
        runId: result.runId,
        storeDate: result.storeDate,
        userId: connection.userId,
      });
    } catch {
      // Operational logging is observability, never a gate. Losing a log line
      // must not fail an otherwise successful check or stop later accounts.
    }
  }
}
