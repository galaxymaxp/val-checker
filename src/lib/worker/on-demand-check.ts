import "server-only";

import type { DailyStorefrontSummary } from "@/src/lib/worker/storefront-worker";

export type OnDemandCheckOutcome = {
  readonly ran: boolean;
  readonly summary: DailyStorefrontSummary | null;
};

/**
 * Runs the daily check for one signed-in user when their storefront has not
 * been recorded yet for the current UTC rotation.
 *
 * This does not widen Riot exposure. The cadence cap lives in
 * claim_riot_daily_run, which admits at most one storefront request per
 * connection per PostgreSQL-derived UTC store date. If the scheduled run
 * already claimed today, this returns without contacting Riot; if the schedule
 * has not run yet, this spends that same single allowance instead of leaving
 * the user with nothing. It can never produce a second request.
 */
export async function runDailyCheckForUser(
  userId: string,
): Promise<OnDemandCheckOutcome> {
  const { buildConfiguredDailyStorefrontWorker } = await import(
    "@/src/lib/worker/storefront-runtime"
  );

  const worker = await buildConfiguredDailyStorefrontWorker(userId);
  const summary = await worker.run();

  return { ran: summary.checked > 0, summary };
}
