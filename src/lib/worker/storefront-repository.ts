import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { decideSessionLifecycle } from "@/src/lib/riot/session-lifecycle";
import type { Database } from "@/src/types/database";
import type {
  DailyRunClaim,
  DailyStorefrontRepository,
  LifecycleApplication,
  RunLogEntry,
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

export class SupabaseDailyStorefrontRepository
  implements DailyStorefrontRepository
{
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listConnections(): Promise<readonly WorkerConnection[]> {
    const { data, error } = await this.supabase
      .from("riot_connections")
      .select(
        "auth_status, connection_epoch, consecutive_failures, created_at, id, last_refresh_at, region, user_id",
      )
      .order("user_id", { ascending: true });
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

  async claim(connection: WorkerConnection): Promise<DailyRunClaim | null> {
    const { data, error } = await this.supabase.rpc("claim_riot_daily_run", {
      p_connection_epoch: connection.connectionEpoch,
      p_connection_id: connection.id,
      p_user_id: connection.userId,
    });
    const claim = data?.[0];
    const claimedAt = claim ? validDate(claim.claimed_at) : null;
    if (error || (claim && !claimedAt)) {
      throw new StorefrontWorkerRepositoryError();
    }
    if (!claim || !claimedAt) {
      return null;
    }

    return {
      claimedAt,
      id: claim.run_id,
      storeDate: claim.store_date,
    };
  }

  async markStorefrontAttempt(
    claim: DailyRunClaim,
    connection: WorkerConnection,
  ): Promise<Date | null> {
    const { data, error } = await this.supabase.rpc(
      "mark_riot_storefront_attempt",
      {
        p_connection_epoch: connection.connectionEpoch,
        p_run_id: claim.id,
        p_user_id: connection.userId,
      },
    );
    const attemptedAt = data?.[0]
      ? validDate(data[0].attempted_at)
      : null;
    if (error || (data?.[0] && !attemptedAt)) {
      throw new StorefrontWorkerRepositoryError();
    }
    return attemptedAt;
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
