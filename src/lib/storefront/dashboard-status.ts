import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { RiotAccountView } from "@/src/lib/riot/connection-state";
import type { Database } from "@/src/types/database";
import type { ManualRefreshAvailability } from "@/src/types/riot-connection";

const AUTOMATIC_RUN_MINUTE = 5;
const CLAIM_LEASE_MS = 5 * 60 * 1_000;
type ManualRefreshRow =
  Database["public"]["Tables"]["riot_manual_refreshes"]["Row"];
type ConnectionRefreshRow = Pick<
  Database["public"]["Tables"]["riot_connections"]["Row"],
  | "id"
  | "puuid"
  | "rotation_lease_claimed_at"
  | "rotation_lease_store_date"
  | "rotation_lease_storefront_attempted_at"
  | "rotation_lease_token"
>;

export interface AccountRefreshStatus {
  readonly connectionId: string;
  readonly lastAutomaticAttemptAt: string | null;
  readonly lastAutomaticSuccessAt: string | null;
  readonly lastManualAttemptAt: string | null;
  readonly lastManualSuccessAt: string | null;
  readonly manualAvailability: ManualRefreshAvailability;
  readonly manualUnavailableReason: string | null;
  readonly nextAutomaticAt: string;
  readonly nextManualAt: string;
  readonly recentFailureReason: string | null;
}

export interface StorefrontDashboardStatus {
  readonly accounts: readonly AccountRefreshStatus[];
  readonly nextResetAt: string;
  readonly storeDate: string;
}

function manualAvailability(
  account: RiotAccountView,
  connection: ConnectionRefreshRow | undefined,
  manual: ManualRefreshRow | undefined,
  storeDate: string,
  now: Date,
): Pick<
  AccountRefreshStatus,
  "manualAvailability" | "manualUnavailableReason"
> {
  if (manual?.status === "succeeded") {
    return { manualAvailability: "succeeded", manualUnavailableReason: null };
  }
  if (manual?.status === "requesting") {
    return {
      manualAvailability: manual.failed_at ? "exhausted" : "in-progress",
      manualUnavailableReason: null,
    };
  }
  if (manual?.status === "claimed") {
    const leaseExpired =
      now.getTime() - Date.parse(manual.claimed_at) >= CLAIM_LEASE_MS;
    if (!leaseExpired) {
      return {
        manualAvailability: "in-progress",
        manualUnavailableReason: null,
      };
    }
  }
  if (account.authStatus !== "CONNECTED") {
    return {
      manualAvailability: "unavailable",
      manualUnavailableReason:
        "Reconnect this Riot account before refreshing its store.",
    };
  }
  if (!connection?.puuid) {
    return {
      manualAvailability: "unavailable",
      manualUnavailableReason:
        "Manual refresh unlocks after this account’s Riot identity is verified by its next automatic check.",
    };
  }
  if (
    connection.rotation_lease_token &&
    connection.rotation_lease_store_date === storeDate
  ) {
    if (connection.rotation_lease_storefront_attempted_at) {
      return {
        manualAvailability: "unavailable",
        manualUnavailableReason:
          "A previous storefront request has an uncertain outcome. Manual refresh returns after the next UTC reset or reconnect.",
      };
    }

    const claimedAt = connection.rotation_lease_claimed_at
      ? Date.parse(connection.rotation_lease_claimed_at)
      : Number.NaN;
    if (
      !Number.isFinite(claimedAt) ||
      now.getTime() - claimedAt < CLAIM_LEASE_MS
    ) {
      return {
        manualAvailability: "in-progress",
        manualUnavailableReason:
          "Another automatic or manual refresh is currently running for this Riot account.",
      };
    }
  }
  return { manualAvailability: "available", manualUnavailableReason: null };
}

function nextAutomaticAt(
  storeDate: string,
  nextResetAt: string,
  now: Date,
): string {
  const currentDayRun = new Date(`${storeDate}T00:05:00.000Z`);
  if (
    Number.isFinite(currentDayRun.getTime()) &&
    currentDayRun.getTime() > now.getTime()
  ) {
    return currentDayRun.toISOString();
  }
  const reset = new Date(nextResetAt);
  reset.setUTCMinutes(reset.getUTCMinutes() + AUTOMATIC_RUN_MINUTE);
  return reset.toISOString();
}

/**
 * Builds the server-only refresh read model. Store-day and availability are
 * derived from PostgreSQL UTC, never from the browser's clock or timezone.
 */
export async function loadStorefrontDashboardStatus(
  supabase: SupabaseClient<Database>,
  userId: string,
  accounts: readonly RiotAccountView[],
  now: Date = new Date(),
): Promise<StorefrontDashboardStatus> {
  const { data: storeDays, error: storeDayError } = await supabase.rpc(
    "get_riot_store_day",
  );
  const storeDay = storeDays?.[0];
  if (storeDayError || !storeDay) {
    throw new Error("Storefront refresh status could not be read.");
  }

  if (accounts.length === 0) {
    return {
      accounts: [],
      nextResetAt: storeDay.next_reset_at,
      storeDate: storeDay.store_date,
    };
  }

  const connectionIds = accounts.map((account) => account.id);
  const identityResult = await supabase
    .from("riot_connections")
    .select(
      "id, puuid, rotation_lease_claimed_at, rotation_lease_store_date, rotation_lease_storefront_attempted_at, rotation_lease_token",
    )
    .eq("user_id", userId)
    .in("id", connectionIds);
  if (identityResult.error) {
    throw new Error("Storefront refresh status could not be read.");
  }

  const connectionById = new Map(
    (identityResult.data ?? []).map((row) => [row.id, row]),
  );
  const puuidByConnection = new Map(
    [...connectionById.values()]
      .filter(
        (row): row is typeof row & { puuid: string } =>
          typeof row.puuid === "string" && row.puuid.length > 0,
      )
      .map((row) => [row.id, row.puuid]),
  );
  const currentPuuids = [...new Set(puuidByConnection.values())];
  const manualPromise =
    currentPuuids.length === 0
      ? Promise.resolve({ data: [] as ManualRefreshRow[], error: null })
      : supabase
          .from("riot_manual_refreshes")
          .select(
            "id, riot_puuid, user_id, connection_id, connection_epoch, store_date, claim_token, status, claimed_at, storefront_attempted_at, succeeded_at, failed_at, failure_reason",
          )
          // The allowance is global to the stable Riot account. Its historical
          // owner may differ after a disconnect/handoff, so the read model must
          // follow the current account's PUUID rather than the snapshot user ID.
          .in("riot_puuid", currentPuuids)
          .order("store_date", { ascending: false })
          .limit(Math.max(20, accounts.length * 8));
  const [manualResult, logsResult] = await Promise.all([
    manualPromise,
    supabase
      .from("riot_run_logs")
      .select(
        "connection_id, trigger, ran_at, outcome, reason, classification, run_id",
      )
      .eq("user_id", userId)
      .order("ran_at", { ascending: false })
      .limit(Math.max(40, accounts.length * 12)),
  ]);

  if (manualResult.error || logsResult.error) {
    throw new Error("Storefront refresh status could not be read.");
  }

  const currentManualByPuuid = new Map<string, ManualRefreshRow>();
  const latestManualSuccessByPuuid = new Map<string, string>();
  for (const manual of manualResult.data ?? []) {
    if (
      manual.store_date === storeDay.store_date &&
      !currentManualByPuuid.has(manual.riot_puuid)
    ) {
      currentManualByPuuid.set(manual.riot_puuid, manual);
    }
    if (
      manual.succeeded_at &&
      !latestManualSuccessByPuuid.has(manual.riot_puuid)
    ) {
      latestManualSuccessByPuuid.set(
        manual.riot_puuid,
        manual.succeeded_at,
      );
    }
  }

  const latestAutomaticByConnection = new Map<
    string,
    NonNullable<typeof logsResult.data>[number]
  >();
  const latestAutomaticSuccessByConnection = new Map<string, string>();
  for (const log of logsResult.data ?? []) {
    if (log.trigger !== "cron" && log.trigger !== "operator") {
      continue;
    }
    // Claim-held/not-allowlisted rows are useful operational events, but they
    // are not refresh attempts and must not replace the last claimed run shown
    // in the dashboard.
    if (log.run_id && !latestAutomaticByConnection.has(log.connection_id)) {
      latestAutomaticByConnection.set(log.connection_id, log);
    }
    if (
      log.run_id &&
      log.outcome === "checked" &&
      !latestAutomaticSuccessByConnection.has(log.connection_id)
    ) {
      latestAutomaticSuccessByConnection.set(log.connection_id, log.ran_at);
    }
  }

  return {
    accounts: accounts.map((account) => {
      const connection = connectionById.get(account.id);
      const puuid = connection?.puuid ?? undefined;
      const currentManual = puuid
        ? currentManualByPuuid.get(puuid)
        : undefined;
      const automatic = latestAutomaticByConnection.get(account.id);
      const availability = manualAvailability(
        account,
        connection,
        currentManual,
        storeDay.store_date,
        now,
      );

      return {
        connectionId: account.id,
        lastAutomaticAttemptAt: automatic?.ran_at ?? null,
        lastAutomaticSuccessAt:
          latestAutomaticSuccessByConnection.get(account.id) ?? null,
        lastManualAttemptAt:
          currentManual?.storefront_attempted_at ??
          currentManual?.claimed_at ??
          null,
        lastManualSuccessAt:
          (puuid ? latestManualSuccessByPuuid.get(puuid) : undefined) ?? null,
        ...availability,
        nextAutomaticAt: nextAutomaticAt(
          storeDay.store_date,
          storeDay.next_reset_at,
          now,
        ),
        nextManualAt: storeDay.next_reset_at,
        recentFailureReason: automatic?.reason ?? null,
      };
    }),
    nextResetAt: storeDay.next_reset_at,
    storeDate: storeDay.store_date,
  };
}
