import "server-only";

import type { FetchedStorefront, Session } from "@/src/lib/riot/adapter";
import type { StorefrontRequestDisposition } from "@/src/lib/riot/client";
import type { RiotConnectAllowlist } from "@/src/lib/riot/connect-allowlist";
import type { SentStorefrontNotification } from "@/src/lib/notifications/dedup";
import {
  reauthenticateAndPersist,
  ReauthPersistenceRunError,
} from "@/src/lib/riot/reauth-persistence";
import type { SessionCheckResult } from "@/src/lib/riot/session-lifecycle";
import type { SessionStore } from "@/src/lib/riot/session-store";
import type {
  StorefrontPipelineInput,
  StorefrontPipelineResult,
} from "@/src/lib/storefront/pipeline";
import type {
  PersistableStorefront,
  StorefrontRefreshSnapshot,
} from "@/src/lib/storefront/canonicalize";
import type { Database } from "@/src/types/database";
import { riotAccountDisplayName } from "@/src/lib/riot/account-display";

type AuthStatus = Database["public"]["Enums"]["auth_status"];

export type WorkerConnection = {
  readonly authStatus: AuthStatus;
  readonly connectionEpoch: string;
  readonly consecutiveFailures: number;
  readonly createdAt: string;
  readonly gameName: string | null;
  readonly id: string;
  readonly label: string | null;
  readonly lastRefreshAt: string | null;
  readonly region: string | null;
  readonly tagLine: string | null;
  readonly userId: string;
};

export type DailyRunClaim = {
  readonly claimToken: string | null;
  readonly claimedAt: Date;
  readonly id: string;
  readonly storeDate: string;
};

export type RunClaimResult =
  | { readonly claim: DailyRunClaim; readonly reason: null }
  | {
      readonly claim: null;
      readonly reason: "ACCOUNT_UNAVAILABLE" | "CLAIM_HELD";
    };

export type SessionRotationLease = {
  readonly claimedAt: Date;
  readonly storeDate: string;
  readonly token: string;
};

export type SessionRotationLeaseResult =
  | { readonly lease: SessionRotationLease; readonly reason: null }
  | {
      readonly lease: null;
      readonly reason: "ACCOUNT_UNAVAILABLE" | "SESSION_LEASE_HELD";
    };

export type StorefrontRefreshTrigger = "cron" | "manual" | "operator";

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
  | "ACCOUNT_UNAVAILABLE"
  | "ATTEMPT_FENCED"
  | "CATALOG_FAILED"
  | "DAILY_CLAIM_HELD"
  | "DELIVERY_FAILED"
  | "LIFECYCLE_STALE"
  | "MANUAL_CLAIM_HELD"
  | "NOT_ALLOWLISTED"
  | "REAUTH_FAILED"
  | "REAUTH_REQUIRED_SKIP"
  | "SESSION_UNAVAILABLE"
  | "SESSION_LEASE_HELD"
  | "STOREFRONT_FAILED"
  | "UNEXPECTED";

export type ManualRefreshFailureReason =
  | "LIFECYCLE_STALE"
  | "REAUTH_FAILED"
  | "SESSION_UNAVAILABLE"
  | "STOREFRONT_FAILED"
  | "UNEXPECTED";

export type StorefrontRefreshFailure =
  | {
      readonly reason: ManualRefreshFailureReason;
      readonly retryable: true;
    }
  | {
      readonly reason: "STOREFRONT_FAILED";
      readonly releaseAttemptedLease: boolean;
      readonly retryable: false;
    };

export type RunLogEntry = {
  readonly classification: SessionCheckResult | null;
  readonly connectionId: string;
  readonly emailsSent: number;
  readonly matchesFound: number;
  readonly outcome: RunLogOutcome;
  readonly reason: RunLogReason | null;
  readonly runId: string | null;
  readonly storeDate: string | null;
  readonly trigger: StorefrontRefreshTrigger;
  readonly userId: string;
};

export interface DailyStorefrontRepository {
  acquireSessionRotationLease(
    connection: WorkerConnection,
  ): Promise<SessionRotationLeaseResult>;
  applyLifecycle(
    connection: WorkerConnection,
    result: SessionCheckResult,
    transientStatus: AuthStatus,
  ): Promise<LifecycleApplication>;
  claim(
    connection: WorkerConnection,
    trigger: StorefrontRefreshTrigger,
    lease: SessionRotationLease,
  ): Promise<RunClaimResult>;
  failRefresh(
    claim: DailyRunClaim,
    connection: WorkerConnection,
    trigger: StorefrontRefreshTrigger,
    lease: SessionRotationLease,
    failure: StorefrontRefreshFailure,
  ): Promise<void>;
  listConnections(): Promise<readonly WorkerConnection[]>;
  loadSentNotifications(
    connection: WorkerConnection,
    storeDate: string,
  ): Promise<readonly SentStorefrontNotification[]>;
  loadVerifiedEmail(userId: string): Promise<string | null>;
  markStorefrontAttempt(
    claim: DailyRunClaim,
    connection: WorkerConnection,
    trigger: StorefrontRefreshTrigger,
    lease: SessionRotationLease,
  ): Promise<Date | null>;
  persistPuuid(connection: WorkerConnection, puuid: string): Promise<void>;
  recordStorefrontRefresh(input: {
    readonly checkedAt: Date;
    readonly claim: DailyRunClaim;
    readonly connection: WorkerConnection;
    readonly consumeManualClaim: boolean;
    readonly rotationLease: SessionRotationLease | null;
    readonly storefront: PersistableStorefront;
    readonly trigger: StorefrontRefreshTrigger;
  }): Promise<void>;
  recordRun(entry: RunLogEntry): Promise<void>;
  releaseSessionRotationLease(
    connection: WorkerConnection,
    lease: SessionRotationLease,
  ): Promise<void>;
  renewSessionRotationLease(
    connection: WorkerConnection,
    lease: SessionRotationLease,
  ): Promise<SessionRotationLease | null>;
}

export interface WorkerRiotClient {
  getStore(session: Session): Promise<FetchedStorefront>;
  getPUUID(session: Session): Promise<string>;
  prepareStorefront(session: Session): Promise<void>;
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

export type WorkerStorefrontPreparer = (input: {
  readonly checkedAt: Date;
  readonly storefront: FetchedStorefront;
}) => Promise<StorefrontRefreshSnapshot>;

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
  readonly prepareStorefront: WorkerStorefrontPreparer;
  readonly repository: DailyStorefrontRepository;
  readonly sendExpiry: WorkerExpirySender;
  readonly sendStorefront: WorkerStorefrontSender;
  readonly sessionStore: Pick<SessionStore, "load" | "persistRotated">;
  readonly trigger?: StorefrontRefreshTrigger;
};

export type StorefrontAccountResult = {
  readonly classification: SessionCheckResult | null;
  readonly connectionId: string;
  readonly emailsSent: number;
  readonly matchesFound: number;
  readonly outcome: RunLogOutcome;
  readonly reason: RunLogReason | null;
  readonly refreshPersisted: boolean;
  readonly notificationStatus:
    | "failed"
    | "not-attempted"
    | "not-needed"
    | "succeeded";
  readonly storeDate: string | null;
  readonly trigger: StorefrontRefreshTrigger;
};

export type DailyStorefrontSummary = {
  readonly accounts: readonly StorefrontAccountResult[];
  readonly checked: number;
  readonly failed: number;
  readonly notificationFailures: number;
  readonly processed: number;
  readonly refreshed: number;
  readonly skipped: number;
  readonly trigger: StorefrontRefreshTrigger;
};

type AccountResult = {
  readonly classification: SessionCheckResult | null;
  readonly emailsSent: number;
  readonly matchesFound: number;
  readonly outcome: RunLogOutcome;
  readonly reason: RunLogReason | null;
  readonly refreshPersisted: boolean;
  readonly notificationStatus: StorefrontAccountResult["notificationStatus"];
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
    refreshPersisted: false,
    notificationStatus: "not-attempted",
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

function storefrontRequestDisposition(
  error: unknown,
): StorefrontRequestDisposition | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("storefrontRequest" in error)
  ) {
    return null;
  }

  const value = (error as { readonly storefrontRequest?: unknown })
    .storefrontRequest;
  return value === "ambiguous" || value === "completed" || value === "not-sent"
    ? value
    : null;
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
    const counts = {
      checked: 0,
      failed: 0,
      notificationFailures: 0,
      processed: 0,
      refreshed: 0,
      skipped: 0,
    };
    const accounts: StorefrontAccountResult[] = [];

    for (const connection of connections) {
      counts.processed += 1;
      let result: AccountResult;
      try {
        result = await this.runAccount(connection);
      } catch {
        result = terminated("failed", "UNEXPECTED");
      }
      counts[result.outcome] += 1;
      if (result.refreshPersisted) {
        counts.refreshed += 1;
      }
      if (result.notificationStatus === "failed") {
        counts.notificationFailures += 1;
      }
      accounts.push({
        classification: result.classification,
        connectionId: connection.id,
        emailsSent: result.emailsSent,
        matchesFound: result.matchesFound,
        outcome: result.outcome,
        reason: result.reason,
        refreshPersisted: result.refreshPersisted,
        notificationStatus: result.notificationStatus,
        storeDate: result.storeDate,
        trigger: this.trigger,
      });
      await this.recordRun(connection, result);
    }

    return { ...counts, accounts, trigger: this.trigger };
  }

  private get trigger(): StorefrontRefreshTrigger {
    return this.dependencies.trigger ?? "cron";
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

    const leaseResult =
      await this.dependencies.repository.acquireSessionRotationLease(connection);
    if (!leaseResult.lease) {
      return terminated(
        "skipped",
        leaseResult.reason,
      );
    }
    let rotationLease = leaseResult.lease;
    let rotationLeaseHeld = true;
    const releaseRotationLease = async () => {
      if (!rotationLeaseHeld) {
        return;
      }
      try {
        await this.dependencies.repository.releaseSessionRotationLease(
          connection,
          rotationLease,
        );
        rotationLeaseHeld = false;
      } catch {
        // A pre-attempt lease can still be recovered after five minutes. An
        // attempted lease remains conservative until UTC reset or reconnect.
      }
    };

    try {
      const claimResult = await this.dependencies.repository.claim(
        connection,
        this.trigger,
        rotationLease,
      );
      if (!claimResult.claim) {
        return terminated(
          "skipped",
          claimResult.reason === "ACCOUNT_UNAVAILABLE"
            ? "ACCOUNT_UNAVAILABLE"
            : this.trigger === "manual"
              ? "MANUAL_CLAIM_HELD"
              : "DAILY_CLAIM_HELD",
        );
      }
      const claim = claimResult.claim;

      const claimed = { runId: claim.id, storeDate: claim.storeDate };
    let attemptStarted = false;
    let client: WorkerRiotClient;
    let rotated: Session;
    let storefront: FetchedStorefront;
    let checkedAt: Date;
    // Narrows the closed-vocabulary reason without ever reading an error
    // message, which could otherwise carry session material.
    let phase: RunLogReason = "SESSION_UNAVAILABLE";
    try {
      const material = await this.dependencies.sessionStore.load(
        connection.userId,
        connection.id,
        connection.connectionEpoch,
      );
      if (!material) {
        throw new Error("Current encrypted session is unavailable.");
      }

      phase = "ATTEMPT_FENCED";
      const renewedLease =
        await this.dependencies.repository.renewSessionRotationLease(
          connection,
          rotationLease,
        );
      if (!renewedLease) {
        await this.failRefresh(claim, connection, rotationLease, {
          reason: "LIFECYCLE_STALE",
          retryable: true,
        });
        return terminated("skipped", "SESSION_LEASE_HELD", claimed);
      }
      rotationLease = renewedLease;

      const session = reconstructSession(connection, material);
      client = this.dependencies.createRiotClient({
        region: connection.region,
        session,
      });
      phase = "REAUTH_FAILED";
      rotated = await reauthenticateAndPersist({
        adapter: client,
        connectionId: connection.id,
        expectedConnectionEpoch: connection.connectionEpoch,
        rotationLeaseToken: rotationLease.token,
        session,
        store: this.dependencies.sessionStore,
        userId: connection.userId,
      });

      // Resolve entitlements, PUUID, and client version while the shared lease
      // is still pre-attempt/retryable. The database attempt marker therefore
      // sits immediately before the sole storefront HTTP request.
      phase = "STOREFRONT_FAILED";
      await client.prepareStorefront(rotated);

      phase = "ATTEMPT_FENCED";
      const attemptedAt =
        await this.dependencies.repository.markStorefrontAttempt(
          claim,
          connection,
          this.trigger,
          rotationLease,
        );
      if (!attemptedAt) {
        await this.failRefresh(claim, connection, rotationLease, {
          reason: "LIFECYCLE_STALE",
          retryable: true,
        });
        return terminated("skipped", "ATTEMPT_FENCED", claimed);
      }
      attemptStarted = true;
      checkedAt = attemptedAt;
      phase = "STOREFRONT_FAILED";
      storefront = await client.getStore(rotated);
    } catch (error) {
      if (error instanceof ReauthPersistenceRunError) {
        // A token/epoch/storage fence says nothing about Riot session health.
        phase = "ATTEMPT_FENCED";
      }
      if (phase === "ATTEMPT_FENCED") {
        await this.failRefresh(claim, connection, rotationLease, {
          reason: "LIFECYCLE_STALE",
          retryable: true,
        });
        // A storage/fence failure happened before the Riot storefront call, so
        // it says nothing about session health.
        return terminated("failed", phase, claimed);
      }
      const result = failureClassification(error);
      let lifecycle: LifecycleApplication | null = null;
      try {
        lifecycle = await this.dependencies.repository.applyLifecycle(
          connection,
          result,
          transientStatus(error),
        );
      } catch {
        // The failure/lease state must still be finalized below. In
        // particular, no lifecycle write is allowed to run after a handled
        // terminal close releases the exact attempted lease.
      }

      if (attemptStarted) {
        const disposition = storefrontRequestDisposition(error);
        const releaseAttemptedLease =
          disposition === "completed" || disposition === "not-sent";
        const finalized = await this.failRefresh(
          claim,
          connection,
          rotationLease,
          {
            reason: "STOREFRONT_FAILED",
            releaseAttemptedLease,
            retryable: false,
          },
        );
        if (!releaseAttemptedLease || finalized) {
          // An ambiguous dispatch deliberately remains fenced in the database
          // until UTC reset/reconnect. A handled dispatch is cleared only by
          // the token-fenced terminal RPC; neither path should run the generic
          // pre-attempt release in finally.
          rotationLeaseHeld = false;
        }
      } else {
        await this.failRefresh(claim, connection, rotationLease, {
          reason:
            phase === "SESSION_UNAVAILABLE" || phase === "REAUTH_FAILED"
              ? phase
              : "STOREFRONT_FAILED",
          retryable: true,
        });
      }

      if (!lifecycle) {
        return terminated("failed", phase, {
          ...claimed,
          classification: result,
        });
      }
      if (lifecycle.applied && lifecycle.terminalTransition) {
        try {
          await this.dependencies.sendExpiry({
            email,
            idempotencyKey: `val-checker/session-expired/${claim.id}`,
          });
        } catch {
          // Delivery cannot replace the primary Riot/session classification.
        }
      }
      return terminated("failed", phase, { ...claimed, classification: result });
    }

    // A schema-valid storefront proves session health. Apply that evidence
    // while the exact attempted lease is still held so an older worker can
    // never overwrite a later trigger's lifecycle state after releasing it.
    let healthy: LifecycleApplication | null = null;
    try {
      healthy = await this.dependencies.repository.applyLifecycle(
        connection,
        "OK",
        "CONNECTED",
      );
    } catch {
      // Raw storefront persistence remains authoritative and must still run.
    }

    let snapshot: StorefrontRefreshSnapshot;
    try {
      snapshot = await this.dependencies.prepareStorefront({
        checkedAt,
        storefront,
      });
      await this.persistStorefrontRefresh({
        checkedAt,
        claim,
        connection,
        consumeManualClaim: true,
        rotationLease,
        storefront: snapshot,
      });
      // Raw persistence clears the exact attempted lease in the same database
      // transaction, before catalog/email enrichment can race a newer trigger.
      rotationLeaseHeld = false;
    } catch {
      const finalized = await this.failRefresh(
        claim,
        connection,
        rotationLease,
        {
          reason: "STOREFRONT_FAILED",
          releaseAttemptedLease: true,
          retryable: false,
        },
      );
      if (finalized) {
        rotationLeaseHeld = false;
      }
      return terminated("failed", "STOREFRONT_FAILED", {
        ...claimed,
        classification: "OK",
      });
    }

    const persisted = {
      ...claimed,
      classification: "OK" as const,
      refreshPersisted: true,
    };

    // Automatic checks opportunistically retain the resolved Riot identity.
    // This is deliberately best effort: a successful storefront remains the
    // authoritative result even when account metadata cannot be updated.
    if (this.trigger !== "manual") {
      try {
        const puuid = await client.getPUUID(rotated);
        await this.dependencies.repository.persistPuuid(connection, puuid);
      } catch {
        // Metadata enrichment is never a storefront or session-health gate.
      }
    }

    if (!healthy) {
      return terminated("checked", "UNEXPECTED", {
        ...persisted,
      });
    }
    if (!healthy.applied) {
      return terminated("checked", "LIFECYCLE_STALE", {
        ...persisted,
      });
    }

    let matchesFound = 0;
    let plan: StorefrontPipelineResult;
    try {
      const sentNotifications =
        await this.dependencies.repository.loadSentNotifications(
          connection,
          claim.storeDate,
        );
      plan = await this.dependencies.pipeline({
        accountName: riotAccountDisplayName(connection, 0),
        checkedAt,
        connectionId: connection.id,
        sentNotifications,
        storefront,
        userId: connection.userId,
      });
      matchesFound = plan.matches.length;
      await this.persistStorefrontRefresh({
        checkedAt,
        claim,
        connection,
        consumeManualClaim: false,
        rotationLease: null,
        storefront: plan.canonicalStorefront,
      });
    } catch {
      return terminated("checked", "CATALOG_FAILED", {
        ...persisted,
        matchesFound,
        notificationStatus: "failed",
      });
    }

    try {
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
        notificationStatus:
          plan.emails.length === 0 ? "not-needed" : "succeeded",
        outcome: "checked",
        reason: null,
        refreshPersisted: true,
      };
    } catch {
      // A valid storefront proves session health. Downstream failures are not
      // fed into the Riot session lifecycle.
      return terminated("checked", "DELIVERY_FAILED", {
        ...persisted,
        matchesFound,
        notificationStatus: "failed",
      });
    }
    } finally {
      await releaseRotationLease();
    }
  }

  private async failRefresh(
    claim: DailyRunClaim,
    connection: WorkerConnection,
    lease: SessionRotationLease,
    failure: StorefrontRefreshFailure,
  ): Promise<boolean> {
    try {
      await this.dependencies.repository.failRefresh(
        claim,
        connection,
        this.trigger,
        lease,
        failure,
      );
      return true;
    } catch {
      // The account result remains redacted and later accounts must continue.
      // A failed terminal close deliberately leaves the shared lease fenced.
      return false;
    }
  }

  private async persistStorefrontRefresh(input: {
    readonly checkedAt: Date;
    readonly claim: DailyRunClaim;
    readonly connection: WorkerConnection;
    readonly consumeManualClaim: boolean;
    readonly rotationLease: SessionRotationLease | null;
    readonly storefront: PersistableStorefront;
  }): Promise<void> {
    // The RPC is idempotent for the same owned connection/rotation. One
    // immediate replay covers a committed-but-response-lost ambiguity without
    // spending a second Riot request or minting a new manual claim.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.dependencies.repository.recordStorefrontRefresh({
          ...input,
          trigger: this.trigger,
        });
        return;
      } catch {
        if (attempt === 1) {
          throw new Error("Storefront refresh persistence failed.");
        }
      }
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
        trigger: this.trigger,
        userId: connection.userId,
      });
    } catch {
      // Operational logging is observability, never a gate. Losing a log line
      // must not fail an otherwise successful check or stop later accounts.
    }
  }
}
