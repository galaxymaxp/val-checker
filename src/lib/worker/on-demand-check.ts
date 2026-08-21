import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/src/types/database";
import type { DailyStorefrontSummary } from "@/src/lib/worker/storefront-worker";

export type OnDemandCheckOutcome = {
  readonly ran: boolean;
  readonly summary: DailyStorefrontSummary | null;
};

export class ManualStorefrontTargetError extends Error {
  constructor() {
    super("A specific Riot connection is required for a manual refresh.");
    this.name = "ManualStorefrontTargetError";
  }
}

const DATABASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs the manual allowance for one exact connection owned by the signed-in
 * user. Ownership is checked again by both connection enumeration and the
 * database claim, so a caller-supplied connection id cannot cross accounts.
 *
 * The manual database claim is independent from the automatic daily claim. A
 * pre-request failure is released for retry. Once the fenced Riot request
 * starts, that attempt is retained; record_storefront_refresh atomically marks
 * success only after a valid catalog-independent shop is durable.
 */
export async function runDailyCheckForUser(
  userId: string,
  connectionId?: string,
): Promise<OnDemandCheckOutcome> {
  if (
    !DATABASE_UUID_PATTERN.test(userId) ||
    !connectionId ||
    !DATABASE_UUID_PATTERN.test(connectionId)
  ) {
    throw new ManualStorefrontTargetError();
  }

  const { buildConfiguredDailyStorefrontWorker } = await import(
    "@/src/lib/worker/storefront-runtime"
  );

  const worker = await buildConfiguredDailyStorefrontWorker({
    connectionId,
    trigger: "manual",
    userId,
  });
  const summary = await worker.run();

  return { ran: summary.refreshed > 0, summary };
}

/**
 * Fetches a store immediately after an account is connected or reconnected, so
 * a new account shows offers straight away instead of waiting for the next
 * 00:05 UTC cron.
 *
 * Runs as `operator`, which shares the automatic daily claim. A freshly
 * connected account has not spent that claim, so this fetches; cron later finds
 * it taken and correctly skips. The separate manual allowance is never touched,
 * so connecting does not cost the user their manual refresh.
 *
 * The worker requires an exact connection, so this resolves the caller's
 * connections and runs one per account. Existing accounts are cheap: their
 * daily claim is already spent, so they skip without a Riot call.
 *
 * Never throws — connecting has already succeeded by the time this runs — but
 * failures are logged, because a silent catch here previously hid a
 * configuration error and no store was ever fetched on connect.
 */
export async function runConnectStorefrontFetch(
  userId: string,
  admin?: SupabaseClient<Database>,
): Promise<OnDemandCheckOutcome> {
  if (!DATABASE_UUID_PATTERN.test(userId)) {
    return { ran: false, summary: null };
  }

  try {
    // Reuse the caller's admin client when it already has one; connecting
    // has just used it, and a second client is pure overhead.
    const client =
      admin ??
      (await import("@/src/lib/supabase/server-admin")).createAdminSupabaseClient();
    const { data, error } = await client
      .from("riot_connections")
      .select("id")
      .eq("user_id", userId);

    if (error || !data || data.length === 0) {
      return { ran: false, summary: null };
    }

    let refreshed = 0;
    let last: OnDemandCheckOutcome["summary"] = null;

    for (const row of data) {
      const outcome = await runConnectStorefrontFetchForConnection(
        userId,
        row.id,
      );
      refreshed += outcome.summary?.refreshed ?? 0;
      last = outcome.summary;
    }

    return { ran: refreshed > 0, summary: last };
  } catch (error) {
    console.error("[connect-fetch] storefront fetch failed", {
      kind: error instanceof Error ? error.name : "Unknown",
    });
    return { ran: false, summary: null };
  }
}

/** Exact-account variant used by cloud capture's validation gate. */
export async function runConnectStorefrontFetchForConnection(
  userId: string,
  connectionId: string,
): Promise<OnDemandCheckOutcome> {
  if (
    !DATABASE_UUID_PATTERN.test(userId) ||
    !DATABASE_UUID_PATTERN.test(connectionId)
  ) {
    return { ran: false, summary: null };
  }

  try {
    const { buildConfiguredDailyStorefrontWorker } = await import(
      "@/src/lib/worker/storefront-runtime"
    );
    const worker = await buildConfiguredDailyStorefrontWorker({
      connectionId,
      trigger: "operator",
      userId,
    });
    const summary = await worker.run();
    const account = summary.accounts.find(
      (result) => result.connectionId === connectionId,
    );
    return {
      ran: account?.outcome === "checked" && summary.refreshed > 0,
      summary,
    };
  } catch (error) {
    console.error("[connect-fetch] storefront fetch failed", {
      kind: error instanceof Error ? error.name : "Unknown",
    });
    return { ran: false, summary: null };
  }
}
