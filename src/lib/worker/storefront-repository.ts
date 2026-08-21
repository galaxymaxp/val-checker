import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { decideSessionLifecycle } from "@/src/lib/riot/session-lifecycle";
import type { PersistableStorefront } from "@/src/lib/storefront/canonicalize";
import type { Database } from "@/src/types/database";
import type {
  DailyRunClaim,
  DailyStorefrontRepository,
  LifecycleApplication,
  RunClaimResult,
  RunLogEntry,
  SessionRotationLease,
  SessionRotationLeaseResult,
  StorefrontRefreshFailure,
  StorefrontRefreshTrigger,
  WorkerConnection,
} from "@/src/lib/worker/storefront-worker";

export class StorefrontWorkerRepositoryError extends Error {
  constructor() {
    super("Daily storefront worker storage operation failed.");
    this.name = "StorefrontWorkerRepositoryError";
  }
}

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

const DATABASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SupabaseDailyStorefrontRepository
  implements DailyStorefrontRepository
{
  private readonly onlyConnectionId?: string;
  private readonly onlyUserId?: string;

  /**
   * A target is always an exact (user, connection) pair. This prevents a
   * manual caller from enumerating or claiming a sibling account, while cron
   * and operator-wide runs omit both fields.
   */
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    onlyUserId?: string,
    onlyConnectionId?: string,
  ) {
    if (
      (onlyUserId === undefined) !== (onlyConnectionId === undefined) ||
      (onlyUserId !== undefined &&
        (!DATABASE_UUID_PATTERN.test(onlyUserId) ||
          !DATABASE_UUID_PATTERN.test(onlyConnectionId!)))
    ) {
      throw new StorefrontWorkerRepositoryError();
    }
    this.onlyUserId = onlyUserId;
    this.onlyConnectionId = onlyConnectionId;
  }

  async listConnections(): Promise<readonly WorkerConnection[]> {
    let query = this.supabase
      .from("riot_connections")
      .select(
        "auth_status, connection_epoch, consecutive_failures, created_at, id, last_refresh_at, region, user_id",
      )
      .order("user_id", { ascending: true });

    if (this.onlyUserId !== undefined && this.onlyConnectionId !== undefined) {
      query = query
        .eq("user_id", this.onlyUserId)
        .eq("id", this.onlyConnectionId);
    }

    const { data, error } = await query;
    if (error) {
      throw new StorefrontWorkerRepositoryError();
    }

    return (data ?? []).map((row) => ({
      authStatus: row.auth_status,
      connectionEpoch: row.connection_epoch,
      consecutiveFailures: row.consecutive_failures,
      createdAt: row.created_at,
      id: row.id,
      lastRefreshAt: row.last_refresh_at,
      region: row.region,
      userId: row.user_id,
    }));
  }

  async acquireSessionRotationLease(
    connection: WorkerConnection,
  ): Promise<SessionRotationLeaseResult> {
    const { data, error } = await this.supabase.rpc(
      "claim_riot_session_rotation",
      {
        p_connection_epoch: connection.connectionEpoch,
        p_connection_id: connection.id,
        p_user_id: connection.userId,
      },
    );
    const result = data?.[0];
    if (error || !result) {
      throw new StorefrontWorkerRepositoryError();
    }
    if (result.lease_status === "account_unavailable") {
      return { lease: null, reason: "ACCOUNT_UNAVAILABLE" };
    }
    if (result.lease_status === "held") {
      return { lease: null, reason: "SESSION_LEASE_HELD" };
    }

    const claimedAt = result.claimed_at
      ? validDate(result.claimed_at)
      : null;
    if (
      result.lease_status !== "acquired" ||
      !claimedAt ||
      !result.lease_token
    ) {
      throw new StorefrontWorkerRepositoryError();
    }
    return {
      lease: {
        claimedAt,
        storeDate: result.store_date,
        token: result.lease_token,
      },
      reason: null,
    };
  }

  async loadVerifiedEmail(userId: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabase.auth.admin.getUserById(userId);
      const email = data.user?.email?.trim();
      if (error || !email || !data.user?.email_confirmed_at) {
        return null;
      }
      return email;
    } catch {
      return null;
    }
  }

  async loadSentNotifications(
    connection: WorkerConnection,
    storeDate: string,
  ) {
    const { data: check, error: checkError } = await this.supabase
      .from("shop_checks")
      .select("id")
      .eq("connection_id", connection.id)
      .eq("rotation_date", storeDate)
      .maybeSingle();
    if (checkError) {
      throw new StorefrontWorkerRepositoryError();
    }
    if (!check) {
      return [];
    }

    const { data, error } = await this.supabase
      .from("notifications")
      .select("skin_uuid")
      .eq("user_id", connection.userId)
      .eq("shop_check_id", check.id)
      .not("emailed_at", "is", null);
    if (error) {
      throw new StorefrontWorkerRepositoryError();
    }
    return (data ?? []).map(({ skin_uuid: skinUuid }) => ({
      skinUuid,
      storeDate,
    }));
  }

  async claim(
    connection: WorkerConnection,
    trigger: StorefrontRefreshTrigger,
    lease: SessionRotationLease,
  ): Promise<RunClaimResult> {
    const result =
      trigger === "manual"
        ? await this.supabase.rpc("claim_riot_manual_refresh", {
            p_connection_epoch: connection.connectionEpoch,
            p_connection_id: connection.id,
            p_rotation_lease_token: lease.token,
            p_user_id: connection.userId,
          })
        : await this.supabase.rpc("claim_riot_daily_run", {
            p_connection_epoch: connection.connectionEpoch,
            p_connection_id: connection.id,
            p_rotation_lease_token: lease.token,
            p_user_id: connection.userId,
          });
    const { data, error } = result;
    const claim = data?.[0];
    if (error) {
      throw new StorefrontWorkerRepositoryError();
    }

    if (trigger === "manual") {
      if (!claim || !("claim_status" in claim)) {
        throw new StorefrontWorkerRepositoryError();
      }
      if (claim.claim_status === "account_unavailable") {
        return { claim: null, reason: "ACCOUNT_UNAVAILABLE" };
      }
      if (claim.claim_status === "held") {
        return { claim: null, reason: "CLAIM_HELD" };
      }
      if (claim.claim_status !== "claimed") {
        throw new StorefrontWorkerRepositoryError();
      }
    } else if (!claim) {
      return { claim: null, reason: "CLAIM_HELD" };
    }

    if (!claim) {
      throw new StorefrontWorkerRepositoryError();
    }
    const claimedAt = claim.claimed_at ? validDate(claim.claimed_at) : null;
    if (!claimedAt || !claim.run_id) {
      throw new StorefrontWorkerRepositoryError();
    }

    const claimToken =
      trigger === "manual" &&
      "claim_token" in claim &&
      typeof claim.claim_token === "string" &&
      claim.claim_token.length > 0
        ? claim.claim_token
        : null;
    if (trigger === "manual" && !claimToken) {
      throw new StorefrontWorkerRepositoryError();
    }

    return {
      claim: {
        claimToken,
        claimedAt,
        id: claim.run_id,
        storeDate: claim.store_date,
      },
      reason: null,
    };
  }

  async markStorefrontAttempt(
    claim: DailyRunClaim,
    connection: WorkerConnection,
    trigger: StorefrontRefreshTrigger,
    lease: SessionRotationLease,
  ): Promise<Date | null> {
    if (trigger === "manual" && !claim.claimToken) {
      throw new StorefrontWorkerRepositoryError();
    }

    const result =
      trigger === "manual"
        ? await this.supabase.rpc("mark_riot_manual_storefront_attempt", {
            p_claim_token: claim.claimToken!,
            p_connection_epoch: connection.connectionEpoch,
            p_connection_id: connection.id,
            p_rotation_lease_token: lease.token,
            p_run_id: claim.id,
            p_user_id: connection.userId,
          })
        : await this.supabase.rpc("mark_riot_storefront_attempt", {
            p_connection_epoch: connection.connectionEpoch,
            p_connection_id: connection.id,
            p_rotation_lease_token: lease.token,
            p_run_id: claim.id,
            p_user_id: connection.userId,
          });
    const { data, error } = result;
    const attemptedAt = data?.[0]
      ? validDate(data[0].attempted_at)
      : null;
    if (error || (data?.[0] && !attemptedAt)) {
      throw new StorefrontWorkerRepositoryError();
    }
    return attemptedAt;
  }

  async releaseSessionRotationLease(
    connection: WorkerConnection,
    lease: SessionRotationLease,
  ): Promise<void> {
    const { error } = await this.supabase.rpc(
      "release_riot_session_rotation",
      {
        p_connection_epoch: connection.connectionEpoch,
        p_connection_id: connection.id,
        p_lease_token: lease.token,
        p_user_id: connection.userId,
      },
    );
    if (error) {
      throw new StorefrontWorkerRepositoryError();
    }
  }

  async renewSessionRotationLease(
    connection: WorkerConnection,
    lease: SessionRotationLease,
  ): Promise<SessionRotationLease | null> {
    const { data, error } = await this.supabase.rpc(
      "renew_riot_session_rotation",
      {
        p_connection_epoch: connection.connectionEpoch,
        p_connection_id: connection.id,
        p_lease_token: lease.token,
        p_user_id: connection.userId,
      },
    );
    const renewedAt = data?.[0]
      ? validDate(data[0].renewed_at)
      : null;
    if (error || (data?.[0] && !renewedAt)) {
      throw new StorefrontWorkerRepositoryError();
    }
    return renewedAt ? { ...lease, claimedAt: renewedAt } : null;
  }

  async failRefresh(
    claim: DailyRunClaim,
    connection: WorkerConnection,
    trigger: StorefrontRefreshTrigger,
    lease: SessionRotationLease,
    failure: StorefrontRefreshFailure,
  ): Promise<void> {
    if (!failure.retryable) {
      if (failure.reason !== "STOREFRONT_FAILED") {
        throw new StorefrontWorkerRepositoryError();
      }
      if (!failure.releaseAttemptedLease) {
        // A rejected/aborted storefront fetch may have reached Riot. Preserve
        // the shared attempted lease until UTC reset/reconnect so no trigger
        // can overlap it. A manual run is still durably marked exhausted.
        if (trigger !== "manual") {
          return;
        }
        if (!claim.claimToken) {
          throw new StorefrontWorkerRepositoryError();
        }
        const { data, error } = await this.supabase.rpc(
          "fail_riot_manual_refresh",
          {
            p_claim_token: claim.claimToken,
            p_connection_epoch: connection.connectionEpoch,
            p_connection_id: connection.id,
            p_failure_reason: failure.reason,
            p_retryable: false,
            p_run_id: claim.id,
            p_user_id: connection.userId,
          },
        );
        if (
          error ||
          !data?.[0] ||
          data[0].status !== "requesting" ||
          !validDate(data[0].failed_at)
        ) {
          throw new StorefrontWorkerRepositoryError();
        }
        return;
      }
      if (trigger === "manual" && !claim.claimToken) {
        throw new StorefrontWorkerRepositoryError();
      }
      const { data, error } = await this.supabase.rpc(
        "close_riot_storefront_attempt",
        {
          p_claim_token: trigger === "manual" ? claim.claimToken : null,
          p_connection_epoch: connection.connectionEpoch,
          p_connection_id: connection.id,
          p_rotation_lease_token: lease.token,
          p_run_id: claim.id,
          p_trigger: trigger,
          p_user_id: connection.userId,
        },
      );
      if (error || !data?.[0] || !validDate(data[0].closed_at)) {
        throw new StorefrontWorkerRepositoryError();
      }
      return;
    }

    if (trigger !== "manual") {
      return;
    }
    if (!claim.claimToken) {
      throw new StorefrontWorkerRepositoryError();
    }

    const { error } = await this.supabase.rpc("fail_riot_manual_refresh", {
      p_claim_token: claim.claimToken,
      p_connection_epoch: connection.connectionEpoch,
      p_connection_id: connection.id,
      p_failure_reason: failure.reason,
      p_retryable: failure.retryable,
      p_run_id: claim.id,
      p_user_id: connection.userId,
    });
    if (error) {
      throw new StorefrontWorkerRepositoryError();
    }
  }

  async persistPuuid(
    connection: WorkerConnection,
    puuid: string,
  ): Promise<void> {
    if (puuid.trim().length === 0) {
      throw new StorefrontWorkerRepositoryError();
    }

    const { data, error } = await this.supabase
      .from("riot_connections")
      .update({ puuid })
      .eq("id", connection.id)
      .eq("user_id", connection.userId)
      .eq("connection_epoch", connection.connectionEpoch)
      .neq("auth_status", "REAUTH_REQUIRED")
      .select("id")
      .maybeSingle();
    if (error || !data) {
      throw new StorefrontWorkerRepositoryError();
    }
  }

  async recordStorefrontRefresh(
    input: Parameters<DailyStorefrontRepository["recordStorefrontRefresh"]>[0],
  ): Promise<void> {
    if (!Number.isFinite(input.checkedAt.getTime())) {
      throw new StorefrontWorkerRepositoryError();
    }
    const checkedAt = input.checkedAt.toISOString();
    const expiresAt = validDate(input.storefront.expiresAt);
    if (
      !expiresAt ||
      input.storefront.storeDate !== input.claim.storeDate ||
      checkedAt.slice(0, 10) !== input.storefront.storeDate
    ) {
      throw new StorefrontWorkerRepositoryError();
    }

    const consumeManualClaim =
      input.trigger === "manual" && input.consumeManualClaim;
    if (input.consumeManualClaim !== (input.rotationLease !== null)) {
      throw new StorefrontWorkerRepositoryError();
    }
    if (consumeManualClaim && !input.claim.claimToken) {
      throw new StorefrontWorkerRepositoryError();
    }

    const { data, error } = await this.supabase.rpc(
      "record_storefront_refresh",
      {
        p_checked_at: checkedAt,
        p_connection_epoch: input.connection.connectionEpoch,
        p_connection_id: input.connection.id,
        p_expires_at: expiresAt.toISOString(),
        p_manual_claim_token: consumeManualClaim
          ? input.claim.claimToken
          : null,
        p_manual_run_id: consumeManualClaim ? input.claim.id : null,
        p_offer_details: input.storefront.offers,
        p_offer_skin_uuids: [...input.storefront.skinUuids],
        p_rotation_date: input.storefront.storeDate,
        p_rotation_lease_token: input.rotationLease?.token ?? null,
        p_shop_hash: input.storefront.shopHash,
        p_user_id: input.connection.userId,
      },
    );
    const recorded = data?.[0];
    if (error || !recorded?.shop_check_id) {
      throw new StorefrontWorkerRepositoryError();
    }
    if (
      consumeManualClaim &&
      (!recorded.manual_succeeded_at ||
        !validDate(recorded.manual_succeeded_at))
    ) {
      throw new StorefrontWorkerRepositoryError();
    }

    await this.recordStorefrontExtras(
      recorded.shop_check_id,
      input.storefront,
    );
  }

  /**
   * Writes the featured bundle and night market onto the row the refresh RPC
   * just created. They are a second statement rather than RPC arguments
   * because changing that function's signature means a migration against a
   * ledger that is deliberately gated, and neither column is load-bearing:
   * a failure here costs a display panel, not the storefront claim that was
   * just spent. It therefore never throws.
   */
  private async recordStorefrontExtras(
    shopCheckId: string,
    storefront: PersistableStorefront,
  ): Promise<void> {
    if (!storefront.bundle && !storefront.nightMarket) {
      return;
    }

    try {
      await this.supabase
        .from("shop_checks")
        .update({
          bundle: storefront.bundle,
          night_market: storefront.nightMarket,
        })
        .eq("id", shopCheckId);
    } catch {
      // Deliberately swallowed; see the contract above.
    }
  }

  async recordRun(entry: RunLogEntry): Promise<void> {
    const { error } = await this.supabase.from("riot_run_logs").insert({
      classification: entry.classification,
      connection_id: entry.connectionId,
      emails_sent: entry.emailsSent,
      matches_found: entry.matchesFound,
      outcome: entry.outcome,
      reason: entry.reason,
      run_id: entry.runId,
      store_date: entry.storeDate,
      trigger: entry.trigger,
      user_id: entry.userId,
    });
    if (error) {
      throw new StorefrontWorkerRepositoryError();
    }
  }

  async applyLifecycle(
    connection: WorkerConnection,
    result: "OK" | "DEAD" | "UNKNOWN" | "ERROR",
    transientStatus: Database["public"]["Enums"]["auth_status"],
  ): Promise<LifecycleApplication> {
    const decision = decideSessionLifecycle(
      {
        consecutiveFailures: connection.consecutiveFailures,
        status:
          connection.authStatus === "REAUTH_REQUIRED"
            ? "reauth-required"
            : "checking",
      },
      result,
    );
    const terminalTransition =
      result === "DEAD" || decision.nextState.status === "reauth-required";
    const authStatus = terminalTransition
      ? "REAUTH_REQUIRED"
      : result === "OK"
        ? "CONNECTED"
        : transientStatus;

    const { data, error } = await this.supabase
      .from("riot_connections")
      .update({
        auth_status: authStatus,
        consecutive_failures: decision.nextState.consecutiveFailures,
      })
      .eq("id", connection.id)
      .eq("user_id", connection.userId)
      .eq("connection_epoch", connection.connectionEpoch)
      .neq("auth_status", "REAUTH_REQUIRED")
      .select("id")
      .maybeSingle();
    if (error) {
      throw new StorefrontWorkerRepositoryError();
    }

    return { applied: data !== null, terminalTransition: data !== null && terminalTransition };
  }
}
